#!/usr/bin/env python3
import sqlite3
import re
import math
from pathlib import Path

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

# Motifs d'en-têtes et pieds de page à supprimer (astérisques échappées avec \*)
patterns_top = [
    r"(?i)^\s*\*\*\*\s*START OF (THIS|THE) PROJECT GUTENBERG EBOOK.*?\*\*\*\s*",
    r"(?i)^\s*Project Gutenberg's.*?\n\n",
    r"(?i)^\s*Produced by.*?\n\n",
    r"(?i)^\s*Ce fichier texte est issu des collections de Wikisource.*?\n\n",
    r"(?i)^\s*Transcrit par.*?\n\n",
    r"(?i)^\s*Édition numérisée par.*?\n\n",
]

patterns_bottom = [
    r"(?i)\s*\*\*\*\s*END OF (THIS|THE) PROJECT GUTENBERG EBOOK.*",
    r"(?i)\s*End of (this|the) Project Gutenberg EBook.*",
    r"(?i)\s*\*\*\*\s*END OF THIS PROJECT GUTENBERG EBOOK\s*\*\*\*",
    r"(?i)\s*Fin de ce texte numérisé par Wikisource.*",
]

rows = c.execute("SELECT id, texte_integral FROM oeuvres").fetchall()

cleaned_texts_count = 0

for r_id, txt in rows:
    if not txt:
        continue
    
    new_txt = txt
    
    # 1. Purge des bannières de début de texte
    for pt in patterns_top:
        new_txt = re.sub(pt, "", new_txt, flags=re.DOTALL | re.MULTILINE)
        
    # 2. Purge des bannières de fin de texte
    for pb in patterns_bottom:
        new_txt = re.sub(pb, "", new_txt, flags=re.DOTALL | re.MULTILINE)
        
    new_txt = new_txt.strip()
    
    # 3. Recalcul des métadonnées volumétriques
    words = len(new_txt.split())
    chars = len(new_txt)
    reading_time_min = max(1, math.ceil(words / 200))
    
    if len(new_txt) != len(txt):
        cleaned_texts_count += 1
        
    c.execute("""
        UPDATE oeuvres 
        SET texte_integral = ?, nb_mots = ?, nb_caracteres = ?, temps_lecture_min = ? 
        WHERE id = ?
    """, (new_txt, words, chars, reading_time_min, r_id))

conn.commit()
total = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]
conn.close()

print("=== RAPPORT DE NETTOYAGE PASSE 3 (CORPS DE TEXTE) ===")
print(f"Œuvres analysées                         : {total}")
print(f"Textes purgés d'en-têtes / pieds de page : {cleaned_texts_count}")
print(f"Compteurs mots/caractères/temps mis à jour: {total}")
print("====================================================")
