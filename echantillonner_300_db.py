#!/usr/bin/env python3
import sqlite3
import json
import random
import re
from pathlib import Path
from collections import defaultdict

db_path = Path('/data/data/com.termux/files/home/lab_litteraire/oeuvres.db')
export_path = Path('/data/data/com.termux/files/home/lab_litteraire/echantillon_300.json')

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
c = conn.cursor()

total_count = c.execute("SELECT COUNT(*) FROM oeuvres").fetchone()[0]

# 1. Analyse des doublons et similitudes sur l'ensemble de la base
rows_all = c.execute("SELECT id, titre, auteur, nb_mots, type_genre, siecle FROM oeuvres").fetchall()

title_clusters = defaultdict(list)
for r in rows_all:
    # Normalisation simplifiée du titre pour regrouper les similitudes
    clean_t = re.sub(r'[^\w\s]', '', (r['titre'] or '').lower()).strip()
    clean_a = re.sub(r'[^\w\s]', '', (r['auteur'] or '').lower()).strip()
    key = f"{clean_t}___{clean_a}"
    title_clusters[key].append(dict(r))

similar_groups = [items for key, items in title_clusters.items() if len(items) > 1]

# 2. Tirage stratifié de 300 œuvres au hasard selon la répartition des genres
genres = c.execute("SELECT DISTINCT type_genre FROM oeuvres").fetchall()
sample_300 = []

TARGET_SAMPLE = 300
for g_row in genres:
    g_name = g_row['type_genre']
    g_rows = c.execute("SELECT * FROM oeuvres WHERE type_genre = ?", (g_name,)).fetchall()
    g_count = len(g_rows)
    
    # Proportion relative dans le tirage
    quota = max(1, int(round((g_count / total_count) * TARGET_SAMPLE)))
    sampled_rows = random.sample(g_rows, min(quota, g_count))
    
    for r in sampled_rows:
        item = dict(r)
        txt = item.get("texte_integral") or ""
        
        # Extrait du début et de la fin pour inspection rapide
        head_snippet = txt[:250].replace('\n', ' ')
        tail_snippet = txt[-250:].replace('\n', ' ') if len(txt) > 500 else ""
        
        # Détection d'anomalies visuelles sur l'échantillon
        anomalies = []
        if len(txt) < 300 and item.get("type_genre") not in ["Poésie", "Contes & Nouvelles"]:
            anomalies.append("Texte très court pour un roman")
        if re.search(r'(http|www|gutenberg|wikisource|archive\.org)', txt[:300], re.I):
            anomalies.append("En-tête web ou bruit résiduel")
        if not item.get("auteur") or item.get("auteur") == "Inconnu":
            anomalies.append("Auteur manquant")
            
        sample_entry = {
            "id": item.get("id"),
            "titre": item.get("titre"),
            "auteur": item.get("auteur"),
            "type_genre": item.get("type_genre"),
            "siecle": item.get("siecle"),
            "nb_mots": item.get("nb_mots"),
            "anomalies_detectees": anomalies,
            "extrait_debut": head_snippet,
            "extrait_fin": tail_snippet
        }
        sample_300.append(sample_entry)

# Ajuster strictement à 300 éléments si arrondi légèrement supérieur
sample_300 = sample_300[:TARGET_SAMPLE]

# 3. Exportation du fichier de contrôle JSON
export_data = {
    "total_base": total_count,
    "taille_echantillon": len(sample_300),
    "groupes_similaires_detectes": len(similar_groups),
    "echantillon": sample_300
}

with open(export_path, "w", encoding="utf-8") as f:
    json.dump(export_data, f, ensure_ascii=False, indent=2)

conn.close()

# 4. Rapport de sortie dans le terminal
anomalies_count = sum(1 for item in sample_300 if item["anomalies_detectees"])

print("=== RAPPORT D'ÉCHANTILLONNAGE & SIMILITUDES ===")
print(f"Œuvres totales dans la base       : {total_count}")
print(f"Échantillon aléatoire généré       : {len(sample_300)} œuvres")
print(f"Groupes de similitudes/doublons    : {len(similar_groups)}")
print(f"Anomalies détectées dans l'échantillon : {anomalies_count} / {len(sample_300)}")
print(f"Fichier exporté                    : {export_path}")
print("=================================================")

if anomalies_count > 0:
    print("\nÉchantillon de cas suspects à examiner dans le fichier :")
    for item in sample_300:
        if item["anomalies_detectees"]:
            print(f"  • ID {item['id']} - '{item['titre']}' ({item['auteur']}) : {', '.join(item['anomalies_detectees'])}")
