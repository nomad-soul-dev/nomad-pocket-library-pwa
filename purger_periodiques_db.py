#!/usr/bin/env python3
import sqlite3
from pathlib import Path

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

initial = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]

# Suppression des collections de journaux, revues et périodiques
c.execute("""
    DELETE FROM oeuvres 
    WHERE LOWER(titre) LIKE 'l''illustration%'
       OR LOWER(titre) LIKE 'illustration no%'
       OR LOWER(titre) LIKE 'revue des deux mondes%'
       OR LOWER(titre) LIKE 'journal des%'
       OR (LOWER(auteur) LIKE '%déterminer%' AND (titre LIKE '%No.%' OR titre LIKE '%N°%'))
""")
deleted_magazines = c.rowcount

conn.commit()
final = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]
conn.close()

print("=== PURGE DES PÉRIODIQUES ET REVUES ===")
print(f"Œuvres initiales            : {initial}")
print(f"Numéros de journaux purgés : {deleted_magazines}")
print(f"Vrais romans/livres finaux : {final}")
print("=======================================")
