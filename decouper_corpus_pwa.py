#!/usr/bin/env python3
import json
import gzip
from pathlib import Path

input_path = Path.home() / "lab_litteraire" / "master_cleaned.json"
output_dir = Path.home() / "nomad-pocket-library-pwa" / "public" / "corpus"

output_dir.mkdir(parents=True, exist_ok=True)

print(f"Chargement du corpus nettoyé : {input_path}")
with open(input_path, "r", encoding="utf-8") as f:
    works = json.load(f)

total_works = len(works)
print(f"Total d'œuvres intégraux à traiter : {total_works}")

CHUNK_SIZE = 18
catalog = []
part_count = 0

for i in range(0, total_works, CHUNK_SIZE):
    chunk_works = works[i:i + CHUNK_SIZE]
    part_count += 1
    part_filename = f"corpus_part_{part_count}.bin"
    
    for item in chunk_works:
        contenu = item.get("texte_integral", "")
        word_count = item.get("word_count") or len(contenu.split())
        
        cat_item = {
            "id": item.get("id"),
            "titre": item.get("titre"),
            "auteur": item.get("auteur", "Inconnu"),
            "tome": item.get("tome"),
            "type_genre": item.get("type_genre"),
            "categories_tags": item.get("categories_tags"),
            "annee_publication": item.get("annee_publication"),
            "dates_auteur": item.get("dates_auteur"),
            "word_count": word_count,
            "part_file": part_filename
        }
        catalog.append(cat_item)

    chunk_json_bytes = json.dumps(chunk_works, ensure_ascii=False).encode('utf-8')
    compressed_bytes = gzip.compress(chunk_json_bytes)
    
    with open(output_dir / part_filename, "wb") as f_out:
        f_out.write(compressed_bytes)

with open(output_dir / "catalog_index.json", "w", encoding="utf-8") as f_cat:
    json.dump(catalog, f_cat, ensure_ascii=False, indent=2)

manifest = {
    "total_works": total_works,
    "total_parts": part_count,
    "chunk_size": CHUNK_SIZE,
    "version": "1.0-cleaned"
}
with open(output_dir / "manifest.json", "w", encoding="utf-8") as f_man:
    json.dump(manifest, f_man, ensure_ascii=False, indent=2)

print("\n=== ASSEMBLAGE PWA TERMINÉ ===")
print(f"Œuvres dans le catalogue : {len(catalog)}")
print(f"Fichiers .bin créés      : {part_count}")
print(f"Dossier de destination   : {output_dir}")
print("================================")
