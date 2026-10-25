#!/usr/bin/env python3
import sqlite3
from pathlib import Path

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

initial = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]

# Suppression des dictionnaires, encyclopédies, index et fiches incompletement identifiées
c.execute("""
    DELETE FROM oeuvres 
    WHERE LOWER(titre) LIKE '%dictionnaire%'
       OR LOWER(titre) LIKE '%encyclopédie%'
       OR LOWER(titre) LIKE '%encyclopedie%'
       OR LOWER(titre) LIKE '%index %'
       OR LOWER(titre) LIKE 'index/%'
       OR LOWER(auteur) LIKE '%déterminer%'
       OR LOWER(auteur) LIKE '%inconnu%'
       OR auteur IS NULL
       OR TRIM(auteur) = ''
""")
deleted_count = c.rowcount

conn.commit()
final = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]
conn.close()

print("=== PURGE DES DICTIONNAIRES ET FICHES INCOMPLÈTES ===")
print(f"Œuvres initiales               : {initial}")
print(f"Dictionnaires / stubs supprimés : {deleted_count}")
print(f"Romans et œuvres pures conservés : {final}")
print("====================================================")
