#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

IA_NOISE_PATTERNS = [
    r"(?i)skip to main content.*?\n",
    r"(?i)keep the news in the wayback machine.*?\n",
    r"(?i)hamburger icon.*?\n",
    r"window\.addEventListener\s*\(\s*'DOMContentLoaded'.*?\);\n?",
    r"https?://web\.archive\.org/web/\d+/\S+",
]

NUMERIC_TITLE_REGEX = re.compile(
    r"^(\d+[\).]?|[IVXLCDM]+\.?|préface|avant-propos|dédicace|texte entier)$",
    re.IGNORECASE,
)

def clean_text_content(text: str) -> str:
    if not text:
        return ""
    cleaned = text
    for pattern in IA_NOISE_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned)
    return cleaned.strip()

def normalize_title(title: str) -> str:
    t = title.lower()
    t = re.sub(r"[\W_]+", " ", t, flags=re.UNICODE)
    return t.strip()

def is_poetry(item: dict) -> bool:
    genre = str(item.get("type_genre", "")).lower()
    tags = str(item.get("categories_tags", "")).lower()
    return "poésie" in genre or "poesie" in genre or "poésie" in tags or "poesie" in tags

def process_corpus(input_file: Path, output_file: Path, dry_run: bool = True):
    print(f"Loading corpus: {input_file}")
    with open(input_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    original_count = len(data)
    print(f"Total œuvres initiales : {original_count}\n")

    cleaned_data = []
    stats = {
        "purged_ia_noise": 0,
        "dropped_isolated_titles": 0,
        "dropped_short_prose": 0,
        "dropped_duplicates": 0,
    }

    grouped_works = {}

    for item in data:
        raw_title = item.get("titre", "").strip()
        auteur = item.get("auteur", "Inconnu").strip()
        contenu = item.get("texte_integral", "")

        cleaned_content = clean_text_content(contenu)
        if len(cleaned_content) < len(contenu):
            stats["purged_ia_noise"] += 1
        item["texte_integral"] = cleaned_content

        word_count = len(cleaned_content.split())
        item["word_count"] = word_count

        if NUMERIC_TITLE_REGEX.match(raw_title):
            stats["dropped_isolated_titles"] += 1
            continue

        if word_count < 500 and not is_poetry(item):
            stats["dropped_short_prose"] += 1
            continue

        key = (normalize_title(raw_title), auteur.lower())
        if key not in grouped_works:
            grouped_works[key] = []
        grouped_works[key].append(item)

    for key, items in grouped_works.items():
        if len(items) > 1:
            stats["dropped_duplicates"] += len(items) - 1
            best_version = max(items, key=lambda x: x.get("word_count", 0))
            cleaned_data.append(best_version)
        else:
            cleaned_data.append(items[0])

    final_count = len(cleaned_data)
    total_removed = original_count - final_count

    print("=== RAPPORT DE NETTOYAGE ===")
    print(f"Œuvres analysées           : {original_count}")
    print(f"Textes avec bruit IA purgé : {stats['purged_ia_noise']}")
    print(f"Titres orphelins supprimés : {stats['dropped_isolated_titles']}")
    print(f"Prose < 500 mots supprimée : {stats['dropped_short_prose']}")
    print(f"Vrais doublons éliminés    : {stats['dropped_duplicates']}")
    print(f"Total d'œuvres conservées  : {final_count} (-{total_removed})")
    print("============================")

    if not dry_run:
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(cleaned_data, f, ensure_ascii=False, indent=2)
        print(f"\n✅ Fichier nettoyé sauvegardé sous : {output_file}")
    else:
        print("\n⚠️ Mode SIMULATION active (--dry-run). Aucun fichier n'a été modifié.")
        print("Pour appliquer les modifications, relancez avec la commande :")
        print(f"python {Path(__file__).name} --apply")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Nettoyage du corpus JSON lab_litteraire")
    parser.add_argument("--input", type=str, default="master_final.json", help="Fichier JSON d'entrée")
    parser.add_argument("--output", type=str, default="master_cleaned.json", help="Fichier JSON de sortie")
    parser.add_argument("--apply", action="store_true", help="Applique les modifications sur le disque")
    args = parser.parse_args()

    process_corpus(Path(args.input), Path(args.output), dry_run=not args.apply)
