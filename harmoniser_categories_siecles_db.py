#!/usr/bin/env python3
import sqlite3
import re
from pathlib import Path

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

rows = c.execute("SELECT id, titre, type_genre, siecle, dates_auteur, categories_tags FROM oeuvres").fetchall()

genre_updated = 0
siecle_updated = 0

def clean_genre(raw_genre):
    if not raw_genre:
        return "Roman"
    g = raw_genre.lower().strip()
    if "poé" in g or "poes" in g:
        return "Poésie"
    elif "théâ" in g or "theat" in g or "comédie" in g or "tragédie" in g:
        return "Théâtre"
    elif "fable" in g or "conte" in g or "nouvelle" in g:
        return "Contes & Nouvelles"
    elif "essai" in g or "philo" in g or "pensée" in g or "discours" in g:
        return "Essai & Philosophie"
    elif "histoi" in g or "biograp" in g or "mémoire" in g or "journal" in g:
        return "Histoire & Biographies"
    elif "roman" in g or "prose" in g or "livre" in g:
        return "Roman"
    else:
        return "Roman"

def infer_siecle(dates_str):
    if not dates_str:
        return None
    years = [int(y) for y in re.findall(r'\b\d{4}\b', dates_str)]
    if not years:
        return None
    
    # Estimation du siècle d'activité principale (milieu de vie ou décès)
    avg_year = sum(years) // len(years) if len(years) > 1 else years[0]
    century_num = (avg_year // 100) + 1
    
    roman_numerals = {
        13: "XIIIe siècle", 14: "XIVe siècle", 15: "XVe siècle",
        16: "XVIe siècle", 17: "XVIIe siècle", 18: "XVIIIe siècle",
        19: "XIXe siècle", 20: "XXe siècle", 21: "XXIe siècle"
    }
    return roman_numerals.get(century_num)

for r_id, tit, old_g, old_s, dates_aut, tags in rows:
    new_g = clean_genre(old_g)
    new_s = old_s
    
    if not new_s or new_s.strip() == "":
        inferred_s = infer_siecle(dates_aut)
        if inferred_s:
            new_s = inferred_s
            
    if new_g != old_g or new_s != old_s:
        if new_g != old_g:
            genre_updated += 1
        if new_s != old_s:
            siecle_updated += 1
        c.execute(
            "UPDATE oeuvres SET type_genre = ?, siecle = ? WHERE id = ?",
            (new_g, new_s, r_id)
        )

conn.commit()
total = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]

genres_summary = c.execute("SELECT type_genre, COUNT(*) FROM oeuvres GROUP BY type_genre ORDER BY COUNT(*) DESC").fetchall()
siecles_summary = c.execute("SELECT siecle, COUNT(*) FROM oeuvres GROUP BY siecle ORDER BY COUNT(*) DESC").fetchall()

conn.close()

print("=== RAPPORT PASSE 4 (HARMONISATION GENRES & SIÈCLES) ===")
print(f"Œuvres analysées             : {total}")
print(f"Genres normalisés            : {genre_updated}")
print(f"Siècles attribués / déduits  : {siecle_updated}")
print("---------------------------------------------------------")
print("Répartition par genre :")
for g, cnt in genres_summary:
    print(f"  • {g or 'Non défini'} : {cnt}")
print("---------------------------------------------------------")
print("Répartition par siècle :")
for s, cnt in siecles_summary[:8]:
    print(f"  • {s or 'Non défini'} : {cnt}")
print("=========================================================")
