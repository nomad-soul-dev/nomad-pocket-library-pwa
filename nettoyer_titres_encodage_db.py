#!/usr/bin/env python3
import sqlite3
import re
import html
from pathlib import Path

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

def clean_utf8_mojibake(text):
    if not text:
        return text
    # Convertit les entités HTML
    t = html.unescape(text)
    
    # Table des corruptions UTF-8 (Mojibake) fréquentes
    replacements = {
        'Ã©': 'é', 'Ã¨': 'è', 'Ãª': 'ê', 'Ã«': 'ë',
        'Ã ': 'à', 'Ã¢': 'â', 'Ã®': 'î', 'Ã¯': 'ï',
        'Ã´': 'ô', 'Ã¹': 'ù', 'Ã»': 'û', 'Ã§': 'ç',
        'Ã‰': 'É', 'Ã€': 'À', 'Ã‡': 'Ç',
        'â€™': "'", 'â€˜': "'", 'â€œ': '"', 'â€': '"',
        'â€“': '–', 'â€”': '—', '\xa0': ' '
    }
    for bad, good in replacements.items():
        t = t.replace(bad, good)
    return t.strip()

rows = c.execute("SELECT id, titre, auteur, tome, texte_integral FROM oeuvres").fetchall()

encoding_fixed = 0
titles_cleaned = 0
tomes_extracted = 0

for r_id, old_titre, old_auteur, old_tome, old_texte in rows:
    # 1. Nettoyage encodage
    new_titre = clean_utf8_mojibake(old_titre)
    new_auteur = clean_utf8_mojibake(old_auteur)
    new_texte = clean_utf8_mojibake(old_texte)
    new_tome = old_tome
    
    is_enc_fixed = (new_titre != old_titre) or (new_auteur != old_auteur) or (new_texte != old_texte)
    if is_enc_fixed:
        encoding_fixed += 1

    # 2. Extraction du Tome / Volume s'il est présent dans le titre
    if new_titre:
        tome_match = re.search(r'(?i)\b(tome|volume|vol\.)\s*(\d+|[ivxlcdm]+)\b', new_titre)
        if tome_match:
            extracted_tome = tome_match.group(0)
            if not new_tome:
                new_tome = extracted_tome
                tomes_extracted += 1
            # Retrait du tome du titre principal pour le rendre plus propre
            new_titre = re.sub(r'(?i)[,–-]?\s*\b(tome|volume|vol\.)\s*(\d+|[ivxlcdm]+)\b', '', new_titre).strip()

        # 3. Retrait des crochets [1], [2/2] et numérotations initiales parasites
        new_titre = re.sub(r'\[\d+(/\d+)?\]', '', new_titre).strip()
        new_titre = re.sub(r'^\d+\s*[-–—]\s*', '', new_titre).strip()
        new_titre = re.sub(r'\s+', ' ', new_titre).strip()
        
        if new_titre != old_titre:
            titles_cleaned += 1

    # Mise à jour dans SQLite si modification
    if (new_titre != old_titre) or (new_auteur != old_auteur) or (new_tome != old_tome) or (new_texte != old_texte):
        c.execute("""
            UPDATE oeuvres 
            SET titre = ?, auteur = ?, tome = ?, texte_integral = ? 
            WHERE id = ?
        """, (new_titre, new_auteur, new_tome, new_texte, r_id))

conn.commit()
total = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]
conn.close()

print("=== RAPPORT DE NETTOYAGE PASSE 2 (TITRES & ENCODAGE) ===")
print(f"Œuvres analysées                     : {total}")
print(f"Textes / titres dépollués d'encodage : {encoding_fixed}")
print(f"Titres simplifiés et nettoyés        : {titles_cleaned}")
print(f"Tomes/Volumes extraits vers 'tome'   : {tomes_extracted}")
print("=========================================================")
