#!/usr/bin/env python3
import sqlite3
import re

db_path = '/data/data/com.termux/files/home/lab_litteraire/oeuvres.db'
conn = sqlite3.connect(db_path)

# Enregistrement de la fonction REGEXP dans SQLite
def regexp(expr, item):
    if item is None:
        return False
    return re.search(expr, item, re.IGNORECASE) is not None

conn.create_function("REGEXP", 2, regexp)
c = conn.cursor()

total = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]

# 1. Bruit IA / Wayback Machine
ia_patterns = [r"skip to main content", r"wayback machine", r"addEventListener"]
bruit_count = 0
rows = c.execute("SELECT id, texte_integral FROM oeuvres").fetchall()
for r_id, txt in rows:
    if txt and any(re.search(p, txt, re.IGNORECASE) for p in ia_patterns):
        bruit_count += 1

# 2. Titres numériques / orphelins (ex: "2)", "IV")
orphan_pattern = r"^(\d+[\).]?|[IVXLCDM]+\.?|préface|avant-propos|dédicace)$"
title_orphans = c.execute(
    "SELECT id, titre, auteur FROM oeuvres WHERE titre REGEXP ?",
    (orphan_pattern,)
).fetchall()

# 3. Doublons stricts (Titre normalisé + Auteur)
doubles = c.execute("""
    SELECT LOWER(TRIM(titre)), LOWER(TRIM(auteur)), COUNT(*) as cnt 
    FROM oeuvres 
    GROUP BY LOWER(TRIM(titre)), LOWER(TRIM(auteur)) 
    HAVING cnt > 1
""").fetchall()

# 4. Textes ultra-courts (< 80 mots)
very_short = c.execute("""
    SELECT titre, auteur, type_genre, nb_mots 
    FROM oeuvres 
    WHERE nb_mots < 80 OR length(texte_integral) < 200
""").fetchall()

print("=== AUDIT DE LA BASE OEUVRES.DB (5 098 entrées) ===")
print(f"1. Total enregistrements          : {total}")
print(f"2. Textes contenant du bruit IA   : {bruit_count}")
print(f"3. Titres orphelins (ex: '2)', 'IV') : {len(title_orphans)}")
print(f"4. Groupes de doublons détectés   : {len(doubles)}")
print(f"5. Textes ultra-courts (< 80 mots) : {len(very_short)}")
print("==================================================")

if very_short:
    print("\nÉchantillon des textes < 80 mots (pour vérification) :")
    for t, a, g, m in very_short[:10]:
        print(f"  - [{g}] '{t}' par {a} ({m} mots)")

conn.close()
