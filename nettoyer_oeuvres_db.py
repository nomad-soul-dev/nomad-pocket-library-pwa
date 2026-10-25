#!/usr/bin/env python3
import sqlite3
import re
import shutil
from pathlib import Path

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
backup_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres_backup.db')

# 1. Copie de sauvegarde préalable
print("1. Création de la sauvegarde de sécurité...")
shutil.copy2(db_path, backup_path)
print(f"   Sauvegarde créée : {backup_path}\n")

conn = sqlite3.connect(db_path)

def regexp(expr, item):
    if item is None:
        return False
    return re.search(expr, item, re.IGNORECASE) is not None

conn.create_function("REGEXP", 2, regexp)
c = conn.cursor()

initial_count = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]

# 2. Purge du bruit IA / Internet Archive dans le texte
ia_patterns = [
    r"(?i)skip to main content.*?\n",
    r"(?i)keep the news in the wayback machine.*?\n",
    r"(?i)hamburger icon.*?\n",
    r"window\.addEventListener\s*\(\s*'DOMContentLoaded'.*?\);\n?",
    r"https?://web\.archive\.org/web/\d+/\S+",
]

rows = c.execute("SELECT id, texte_integral FROM oeuvres").fetchall()
cleaned_ia_count = 0
for r_id, txt in rows:
    if not txt:
        continue
    new_txt = txt
    for p in ia_patterns:
        new_txt = re.sub(p, "", new_txt)
    if len(new_txt) < len(txt):
        new_txt = new_txt.strip()
        words = len(new_txt.split())
        chars = len(new_txt)
        c.execute(
            "UPDATE oeuvres SET texte_integral = ?, nb_mots = ?, nb_caracteres = ? WHERE id = ?",
            (new_txt, words, chars, r_id)
        )
        cleaned_ia_count += 1

# 3. Suppression des titres orphelins (ex: "2)", "IV", "préface")
orphan_pattern = r"^(\d+[\).]?|[IVXLCDM]+\.?|préface|avant-propos|dédicace)$"
c.execute("DELETE FROM oeuvres WHERE titre REGEXP ?", (orphan_pattern,))
deleted_orphans = c.rowcount

# 4. Suppression des fiches vides/incomplètes (< 80 mots ET auteur inconnu/incomplet)
c.execute("""
    DELETE FROM oeuvres 
    WHERE (nb_mots < 80 OR length(texte_integral) < 200)
      AND (LOWER(auteur) LIKE '%déterminer%' OR LOWER(auteur) LIKE '%inconnu%' OR auteur IS NULL OR TRIM(auteur) = '')
      AND LOWER(type_genre) NOT LIKE '%poé%' AND LOWER(type_genre) NOT LIKE '%poes%'
""")
deleted_stubs = c.rowcount

# 5. Élimination des doublons (garder la version la plus longue en nombre de mots)
doubles = c.execute("""
    SELECT LOWER(TRIM(titre)), LOWER(TRIM(auteur)), COUNT(*) as cnt 
    FROM oeuvres 
    GROUP BY LOWER(TRIM(titre)), LOWER(TRIM(auteur)) 
    HAVING cnt > 1
""").fetchall()

deleted_duplicates = 0
for t_norm, a_norm, cnt in doubles:
    ids_words = c.execute("""
        SELECT id, nb_mots FROM oeuvres 
        WHERE LOWER(TRIM(titre)) = ? AND LOWER(TRIM(auteur)) = ?
        ORDER BY nb_mots DESC
    """, (t_norm, a_norm)).fetchall()
    
    # Conserver le 1er (le plus long), supprimer les autres
    ids_to_delete = [item[0] for item in ids_words[1:]]
    for del_id in ids_to_delete:
        c.execute("DELETE FROM oeuvres WHERE id = ?", (del_id,))
        deleted_duplicates += 1

conn.commit()

final_count = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]
conn.close()

print("=== RAPPORT DE NETTOYAGE OEUVRES.DB ===")
print(f"Œuvres initiales               : {initial_count}")
print(f"Textes purges du bruit IA      : {cleaned_ia_count}")
print(f"Titres orphelins supprimes     : {deleted_orphans}")
print(f"Fiches vides/stubs supprimees  : {deleted_stubs}")
print(f"Doublons elimines              : {deleted_duplicates}")
print(f"Total d'oeuvres conservees     : {final_count} (-{initial_count - final_count})")
print("=======================================")
