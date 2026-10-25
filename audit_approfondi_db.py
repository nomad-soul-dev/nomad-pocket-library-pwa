#!/usr/bin/env python3
import sqlite3
import re
from pathlib import Path

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
conn = sqlite3.connect(db_path)

# Enregistrement préalable de la fonction REGEXP dans SQLite
def regexp(expr, item):
    if item is None:
        return False
    return re.search(expr, item, re.IGNORECASE) is not None

conn.create_function("REGEXP", 2, regexp)
c = conn.cursor()

total = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]

# 1. Auteurs mal formatés ("Nom, Prénom" ou présence de dates YYYY)
bad_authors = c.execute(r"""
    SELECT id, auteur FROM oeuvres 
    WHERE auteur LIKE '%,%' OR auteur REGEXP '\b\d{4}\b'
""").fetchall()

# 2. Artefacts d'encodage (UTF-8 corrompu)
encoding_bugs = []
rows_texts = c.execute("SELECT id, titre, auteur, texte_integral FROM oeuvres").fetchall()
for r_id, tit, aut, txt in rows_texts:
    combined = f"{tit or ''} {aut or ''} {(txt or '')[:500]}"
    if re.search(r'(Ã©|Ã|â€™|&nbsp;|&eacute;|&#\d+;)', combined):
        encoding_bugs.append((r_id, tit))

# 3. Titres avec crochets ou artefacts [1], Vol, Tome...
title_bugs = []
for r_id, tit, aut, txt in rows_texts:
    if tit and re.search(r'(\[\d+\]|^\d+\s*-|vol\.|tome\s*\d+)', tit, re.I):
        title_bugs.append((r_id, tit))

# 4. Textes très courts (< 150 mots)
short_texts = c.execute("""
    SELECT id, titre, auteur, type_genre, nb_mots 
    FROM oeuvres 
    WHERE nb_mots < 150 OR length(texte_integral) < 400
""").fetchall()

print(f"=== AUDIT APPROFONDI DE OEUVRES.DB ({total} entrées) ===")
print(f"1. Auteurs mal formatés (Nom, Prénom / dates) : {len(bad_authors)}")
print(f"2. Titres/textes avec bugs d'encodage (UTF-8) : {len(encoding_bugs)}")
print(f"3. Titres avec crochets/artefacts [1], Vol... : {len(title_bugs)}")
print(f"4. Œuvres très courtes (< 150 mots)           : {len(short_texts)}")
print("==========================================================")

if bad_authors:
    print("\nÉchantillon d'auteurs à re-formater (Nom, Prénom / dates) :")
    for r_id, aut in bad_authors[:10]:
        print(f"  - ID {r_id} : '{aut}'")

if encoding_bugs:
    print("\nÉchantillon de titres avec bugs d'encodage :")
    for r_id, tit in encoding_bugs[:5]:
        print(f"  - ID {r_id} : '{tit}'")

if short_texts:
    print("\nÉchantillon des œuvres < 150 mots :")
    for r_id, tit, aut, g, m in short_texts[:5]:
        print(f"  - [{g}] '{tit}' par {aut} ({m} mots)")

conn.close()
