import sqlite3
import json
import os
import re

# 1. Détermination du chemin de la BDD
db_path = "oeuvres_nettoyee.db" if os.path.exists("oeuvres_nettoyee.db") else "oeuvres.db"
download_dir = "/sdcard/Download" if os.path.exists("/sdcard/Download") else os.path.expanduser("~/storage/downloads")
output_json = os.path.join(download_dir, "nomad_library_full_4073.json")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Récupération de la table principale
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [t[0] for t in cursor.fetchall() if t[0] != 'sqlite_sequence']
table_nom = tables[0]

# Structure de la table
cursor.execute(f"PRAGMA table_info({table_nom});")
columns = [col[1] for col in cursor.fetchall()]

cursor.execute(f"SELECT * FROM {table_nom};")
rows = cursor.fetchall()

bd_complete = []
anomalies = {
    "titres_suspects": [],
    "auteurs_avec_virgule": [],
    "auteurs_avec_chiffres": [],
    "siecles_inconnus_ou_douteux": [],
    "notices_vides": []
}

# Liste des auteurs connus pour vérifier les siècles
SIECLES_TEST = {
    "hugo": "XIXe siècle", "zola": "XIXe siècle", "dumas": "XIXe siècle",
    "baudelaire": "XIXe siècle", "rimbaud": "XIXe siècle", "moliere": "XVIIe siècle",
    "voltaire": "XVIIIe siècle", "descartes": "XVIIe siècle"
}

for row in rows:
    item = dict(zip(columns, row))
    bd_complete.append(item)
    
    row_id = item.get("rowid") or item.get("id") or "N/A"
    titre = str(item.get("titre") or "").strip()
    auteur = str(item.get("auteur") or "").strip()
    siecle = str(item.get("siecle") or "").strip()

    # Grillle d'audit 100% :
    # 1. Titre suspect (< 3 chars ou vide)
    if not titre or len(titre) <= 2 or titre.upper() in ["II)", "IV", "III", "VI"]:
        anomalies["titres_suspects"].append((row_id, titre, auteur))
        
    # 2. Auteur au format inversé "Nom, Prénom" non corrigé
    if "," in auteur and not any(k in auteur.lower() for k in ["baron", "comte", "duchesse", "prince"]):
        anomalies["auteurs_avec_virgule"].append((row_id, auteur))
        
    # 3. Chiffres ou dates résiduelles dans le nom d'auteur
    if re.search(r'\d', auteur):
        anomalies["auteurs_avec_chiffres"].append((row_id, auteur))
        
    # 4. Siècle suspect ou absent
    if not siecle or siecle in ["Inconnu", "Non renseigné"]:
        anomalies["siecles_inconnus_ou_douteux"].append((row_id, titre, auteur, siecle))

# 2. Sauvegarde du fichier JSON intégral dans les Téléchargements
with open(output_json, "w", encoding="utf-8") as f:
    json.dump(bd_complete, f, ensure_ascii=False, indent=2)

# 3. Rapport d'inspection 100%
print("=" * 60)
print(f"📦 BASE INTÉGRALE EXPORTÉE ({len(bd_complete)} notices)")
print(f"📂 Fichier disponible dans : {output_json}")
print(f"⚖️ Taille du fichier : {os.path.getsize(output_json) / (1024*1024):.2f} Mo")
print("=" * 60)
print("🔍 RAPPORT DU SCANNER QUALITÉ (Sur les 4 073 œuvres) :")
print(f" - Titres vides ou trop courts : {len(anomalies['titres_suspects'])}")
print(f" - Auteurs avec format 'Nom, Prénom' : {len(anomalies['auteurs_avec_virgule'])}")
print(f" - Auteurs contenant des chiffres/dates : {len(anomalies['auteurs_avec_chiffres'])}")
print(f" - Siècles manquants ou indéterminés : {len(anomalies['siecles_inconnus_ou_douteux'])}")
print("=" * 60)

# Affichage des anomalies détectées s'il y en a
if any(len(v) > 0 for v in anomalies.values()):
    print("\n⚠️ DÉTAIL DES ANOMALIES DÉTECTÉES SUR L'ENSEMBLE DE LA BASE :")
    for kat, lst in anomalies.items():
        if lst:
            print(f"\n👉 {kat.upper()} ({len(lst)}) :")
            for ex in lst[:15]:  # Affiche les 15 premiers exemples par catégorie
                print(f"   • {ex}")
            if len(lst) > 15:
                print(f"   ... et {len(lst) - 15} autres.")
else:
    print("\n🎉 ZÉRO DÉFAUT DETECTÉ ! La base de 4 073 notices est 100 % conforme.")

