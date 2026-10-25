import sqlite3
import json
import os
import shutil
import random

# Sélection de la base la plus récente
db_path = "oeuvres_nettoyee.db" if os.path.exists("oeuvres_nettoyee.db") else "oeuvres.db"

if not os.path.exists(db_path):
    # Tentative de récupération depuis Téléchargements
    for dl in ["/sdcard/Download/oeuvres_nettoyee.db", os.path.expanduser("~/storage/downloads/oeuvres_nettoyee.db")]:
        if os.path.exists(dl):
            shutil.copy(dl, db_path)
            break

if not os.path.exists(db_path):
    print("❌ Erreur : Aucune base SQLite 'oeuvres_nettoyee.db' ou 'oeuvres.db' n'a été trouvée.")
    exit(1)

print(f"📦 Connexion à la base de données : {db_path}")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Détection de la table principale
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [t[0] for t in cursor.fetchall() if t[0] != 'sqlite_sequence']

table_nom = tables[0] if tables else None
if not table_nom:
    print("❌ Erreur : Aucune table trouvée dans la base.")
    conn.close()
    exit(1)

cursor.execute(f"PRAGMA table_info({table_nom});")
colonnes = [c[1] for c in cursor.fetchall()]

# Extraction de 500 notices (aléatoire contrôlé pour être représentatif)
cursor.execute(f"SELECT rowid, * FROM {table_nom} ORDER BY RANDOM() LIMIT 500;")
rows = cursor.fetchall()

echantillon = []
repartition_siecles = {}
total_anomalies = 0

for row in rows:
    row_id = row[0]
    data = dict(zip(colonnes, row[1:]))
    
    # Normalisation du champ anomalies_detectees
    anomalies = data.get("anomalies_detectees", [])
    if isinstance(anomalies, str):
        try:
            anomalies = json.loads(anomalies)
        except:
            anomalies = [anomalies] if anomalies else []
    elif not isinstance(anomalies, list):
        anomalies = []

    # Construction de la fiche ultra-complète pour audit
    fiche = {
        "id_base": row_id,
        "titre": data.get("titre", "Inconnu"),
        "auteur": data.get("auteur", "Anonyme"),
        "siecle": data.get("siecle", "Non spécifié"),
        "categorie_genre": data.get("categorie", data.get("genre", "Non classé")),
        "source_origine": data.get("source", data.get("url", "Projet Gutenberg / Wikisource")),
        "longueur_extrait_debut": len(str(data.get("extrait_debut", ""))),
        "longueur_extrait_fin": len(str(data.get("extrait_fin", ""))),
        "extrait_debut": str(data.get("extrait_debut", ""))[:300],
        "extrait_fin": str(data.get("extrait_fin", ""))[:300],
        "nb_anomalies": len(anomalies),
        "anomalies_detectees": anomalies,
        "statut_audit": "VALIDE" if len(anomalies) == 0 else "À REVOIR"
    }
    
    # Statistiques
    siecle = fiche["siecle"]
    repartition_siecles[siecle] = repartition_siecles.get(siecle, 0) + 1
    if len(anomalies) > 0:
        total_anomalies += 1
        
    echantillon.append(fiche)

conn.close()

# Sauvegarde locale du JSON
nom_fichier = "echantillon_500.json"
with open(nom_fichier, "w", encoding="utf-8") as f:
    json.dump(echantillon, f, ensure_ascii=False, indent=2)

print("\n==================================================")
print("     ÉCHANTILLONNAGE ULTRA-COMPLET (500 NOTICES)  ")
print("==================================================")
print(f"✅ Total notices extraites : {len(echantillon)}")
print(f"⚠️  Notices avec anomalies residuelles : {total_anomalies}")
print("\n📊 Répartition par siècle dans l'échantillon :")
for s, count in sorted(repartition_siecles.items(), key=lambda x: x[1], reverse=True):
    print(f"   • {s} : {count} notices")

# Copie vers le dossier Téléchargements du téléphone
copie_ok = False
for dst in ["/sdcard/Download/echantillon_500.json", os.path.expanduser("~/storage/downloads/echantillon_500.json")]:
    try:
        shutil.copy(nom_fichier, dst)
        print(f"\n📲 Fichier copié avec succès dans : {dst}")
        copie_ok = True
        break
    except Exception:
        pass

if not copie_ok:
    print("\n⚠️ Note : Impossible de copier directement vers /sdcard/Download. Utilisez 'termux-setup-storage' si nécessaire.")

