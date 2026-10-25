#!/usr/bin/env python3
import sqlite3
import re
import shutil
from pathlib import Path

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
backup_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres_backup.db')

print("1. Création de la sauvegarde de sécurité...")
shutil.copy2(db_path, backup_path)
print(f"   Sauvegarde créée : {backup_path}\n")

conn = sqlite3.connect(db_path)
c = conn.cursor()

def parse_single_author(author_str):
    """
    Extrait le nom propre à l'endroit, les dates et les rôles/tags d'une chaîne auteur.
    """
    raw = author_str.strip()
    
    # 1. Extraction des rôles/crochets [Composer], [Illustrator], etc.
    roles = re.findall(r'\[(.*?)\]', raw)
    raw = re.sub(r'\[.*?\]', '', raw).strip()
    
    # 2. Extraction des dates (ex: 1828-1905, 1760?-1825)
    dates_match = re.search(r'\b(\d{4}\??\s*[-–—]\s*\d{4}\??|\d{4}\??\s*[-–—]|\?\s*[-–—]\s*\d{4}\??)\b', raw)
    extracted_dates = dates_match.group(1) if dates_match else None
    if dates_match:
        raw = raw.replace(dates_match.group(0), '').strip()
    
    # Nettoyage des virgules traînantes
    raw = re.sub(r',\s*$', '', raw).strip()
    raw = re.sub(r'^\s*,', '', raw).strip()
    
    # 3. Réorganisation Nom, Prénom -> Prénom Nom
    parts = [p.strip() for p in raw.split(',') if p.strip()]
    if len(parts) == 2:
        # Ex: ['Verne', 'Jules'] -> 'Jules Verne'
        clean_name = f"{parts[1]} {parts[0]}"
    elif len(parts) > 2:
        # Ex: ['Abbadie', 'Arnauld d\''] -> 'Arnauld d\' Abbadie'
        clean_name = f"{' '.join(parts[1:])} {parts[0]}"
    elif len(parts) == 1:
        clean_name = parts[0]
    else:
        clean_name = author_str
        
    return clean_name.strip(), extracted_dates, roles

# Traitement de toutes les œuvres
rows = c.execute("SELECT id, auteur, dates_auteur, categories_tags FROM oeuvres").fetchall()

updated_count = 0
samples = []

for r_id, old_aut, old_dates, old_tags in rows:
    if not old_aut:
        continue
        
    # Gestion des auteurs multiples séparés par des point-virgules ';'
    sub_authors = old_aut.split(';')
    clean_names = []
    extracted_dates_list = []
    extracted_roles_list = []
    
    for sa in sub_authors:
        c_name, c_date, c_roles = parse_single_author(sa)
        if c_name:
            clean_names.append(c_name)
        if c_date:
            extracted_dates_list.append(c_date)
        if c_roles:
            extracted_roles_list.extend(c_roles)
            
    final_auteur = " ; ".join(clean_names)
    final_dates = old_dates or (", ".join(extracted_dates_list) if extracted_dates_list else None)
    
    # Mise à jour des tags si des rôles ont été extraits
    tags_list = [t.strip() for t in (old_tags or "").split(',') if t.strip()]
    for r in extracted_roles_list:
        if r not in tags_list:
            tags_list.append(f"Rôle: {r}")
    final_tags = ", ".join(tags_list) if tags_list else old_tags
    
    if final_auteur != old_aut or final_dates != old_dates or final_tags != old_tags:
        c.execute(
            "UPDATE oeuvres SET auteur = ?, dates_auteur = ?, categories_tags = ? WHERE id = ?",
            (final_auteur, final_dates, final_tags, r_id)
        )
        updated_count += 1
        if len(samples) < 10:
            samples.append((old_aut, final_auteur, final_dates))

conn.commit()
total = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]
conn.close()

print(f"=== RAPPORT DE NORMALISATION DES AUTEURS ===")
print(f"Œuvres analysées           : {total}")
print(f"Fiches d'auteurs restructurées : {updated_count}")
print("============================================")

print("\nÉchantillon des transformations effectuées :")
for old_a, new_a, dts in samples:
    print(f"  • AVANT : '{old_a}'")
    print(f"    APRÈS : '{new_a}' | Dates : {dts}\n")
