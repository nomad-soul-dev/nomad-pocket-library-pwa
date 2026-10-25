import sqlite3
import json
import re
import os
import shutil

# 1. Table de correspondance des grands auteurs pour réaligner les siècles
AUTHORS_CENTURY_MAP = {
    "Victor Hugo": "XIXe siècle",
    "Théophile Gautier": "XIXe siècle",
    "Alfred de Vigny": "XIXe siècle",
    "Charles Baudelaire": "XIXe siècle",
    "Gérard de Nerval": "XIXe siècle",
    "Alphonse Daudet": "XIXe siècle",
    "Gustave Flaubert": "XIXe siècle",
    "Honoré de Balzac": "XIXe siècle",
    "Émile Zola": "XIXe siècle",
    "Alexandre Dumas": "XIXe siècle",
    "Guy de Maupassant": "XIXe siècle",
    "Lamartine": "XIXe siècle",
    "Jules Laforgue": "XIXe siècle",
    "Stendhal": "XIXe siècle",
    "George Sand": "XIXe siècle",
    "Jules Verne": "XIXe siècle",
    "Jules Renard": "XIXe siècle",
    "Arthur Rimbaud": "XIXe siècle",
    "Stéphane Mallarmé": "XIXe siècle",
    "Voltaire": "XVIIIe siècle",
    "Denis Diderot": "XVIIIe siècle",
    "Lavoisier": "XVIIIe siècle",
    "Florian": "XVIIIe siècle",
    "Restif de La Bretonne": "XVIIIe siècle",
    "Molière": "XVIIe siècle",
    "Paul Scarron": "XVIIe siècle",
    "Jean de La Fontaine": "XVIIe siècle",
    "Guillaume Apollinaire": "XXe siècle",
    "Marcel Proust": "XXe siècle",
    "René Crevel": "XXe siècle",
    "Alain-Fournier": "XXe siècle",
    "Colette": "XXe siècle",
    "François Mauriac": "XXe siècle"
}

def clean_author(auteur: str) -> str:
    if not auteur or auteur.strip() == "":
        return "Anonyme"
    # Supprime les années préfixées (ex: "1886 Alain-Fournier" -> "Alain-Fournier")
    auteur = re.sub(r"^\d{4}\s+", "", auteur)
    # Supprime les dates en fin de notice (ex: ", 1780" ou ", 354-430")
    auteur = re.sub(r",\s*\d{3,4}(-\d{3,4})?$", "", auteur)
    auteur = re.sub(r"^(Classique / domaine public|Anonymous|Auteur Classique)$", "Anonyme", auteur, flags=re.I)
    return auteur.rstrip(",").strip()

def clean_title(titre: str) -> str:
    if not titre:
        return "Sans titre"
    # Supprime les numérotations initiales parasites (ex: "XX. Les Dons..." -> "Les Dons...")
    titre = re.sub(r"^(?:[IVXLCDM]+\.|\d+\.|\d+\))\s*", "", titre, flags=re.IGNORECASE)
    if titre.isupper() and len(titre) > 4:
        titre = titre.capitalize()
    return titre.strip()

def fix_century(auteur_clean: str, siecle_actuel: str) -> str:
    for key, siecle in AUTHORS_CENTURY_MAP.items():
        if key.lower() in auteur_clean.lower():
            return siecle
    return siecle_actuel

# Connexion DB
db_path = "oeuvres_nettoyee.db" if os.path.exists("oeuvres_nettoyee.db") else "oeuvres.db"
if not os.path.exists(db_path):
    print("❌ Aucune base de données SQLite trouvée.")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Détection automatique de la table
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [t[0] for t in cursor.fetchall() if t[0] != 'sqlite_sequence']
table_nom = tables[0]

cursor.execute(f"PRAGMA table_info({table_nom});")
cols = [c[1] for c in cursor.fetchall()]

# Extraction avec rowid
cursor.execute(f"SELECT rowid, * FROM {table_nom};")
rows = cursor.fetchall()

updates = []
for row in rows:
    row_id = row[0]
    data = dict(zip(cols, row[1:]))
    
    titre_c = clean_title(str(data.get("titre", "")))
    auteur_c = clean_author(str(data.get("auteur", "")))
    siecle_c = fix_century(auteur_c, str(data.get("siecle", "")))
    
    updates.append((titre_c, auteur_c, siecle_c, row_id))

# Application des corrections
cursor.executemany(f"UPDATE {table_nom} SET titre = ?, auteur = ?, siecle = ? WHERE rowid = ?", updates)
conn.commit()
print(f"✅ Nettoyage ciblé effectué sur {len(updates)} notices de la base.")

# Extraction d'un nouvel échantillon de 500 notices
cursor.execute(f"SELECT rowid, * FROM {table_nom} ORDER BY RANDOM() LIMIT 500;")
sample_rows = cursor.fetchall()

echantillon = []
for r in sample_rows:
    row_id = r[0]
    data = dict(zip(cols, r[1:]))
    
    anomalies = data.get("anomalies_detectees", [])
    if isinstance(anomalies, str):
        try:
            anomalies = json.loads(anomalies)
        except:
            anomalies = []
            
    fiche = {
        "id_base": row_id,
        "titre": data.get("titre", ""),
        "auteur": data.get("auteur", ""),
        "siecle": data.get("siecle", ""),
        "categorie_genre": data.get("categorie", data.get("genre", "Non classé")),
        "source_origine": data.get("source", data.get("url", "Projet Gutenberg / Wikisource")),
        "extrait_debut": str(data.get("extrait_debut", ""))[:300],
        "extrait_fin": str(data.get("extrait_fin", ""))[:300],
        "nb_anomalies": len(anomalies),
        "anomalies_detectees": anomalies,
        "statut_audit": "VALIDE" if len(anomalies) == 0 else "À REVOIR"
    }
    echantillon.append(fiche)

conn.close()

# Enregistrement et export
with open("echantillon_500.json", "w", encoding="utf-8") as f:
    json.dump(echantillon, f, ensure_ascii=False, indent=2)

copie_ok = False
for dst in ["/sdcard/Download/echantillon_500.json", os.path.expanduser("~/storage/downloads/echantillon_500.json")]:
    try:
        shutil.copy("echantillon_500.json", dst)
        print(f"📲 Nouvel échantillon de 500 notices copié dans : {dst}")
        copie_ok = True
        break
    except Exception:
        pass

