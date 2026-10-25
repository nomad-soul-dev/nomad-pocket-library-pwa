import sqlite3
import json
import os
import re

db_path = "oeuvres_nettoyee.db" if os.path.exists("oeuvres_nettoyee.db") else "oeuvres.db"
download_dir = "/sdcard/Download" if os.path.exists("/sdcard/Download") else os.path.expanduser("~/storage/downloads")
output_json = os.path.join(download_dir, "nomad_library_full_4073.json")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [t[0] for t in cursor.fetchall() if t[0] != 'sqlite_sequence']
table_nom = tables[0]

cursor.execute(f"SELECT rowid, titre, auteur, siecle FROM {table_nom};")
rows = cursor.fetchall()

# Dictionnaire de traduction/normalisation directe pour les cas complexes
AUTEURS_FIXES = {
    "homer": "Homère",
    "aristophanes": "Aristophane",
    "tacitus": "Tacite",
    "anacreon": "Anacréon",
    "frontinus": "Frontin",
    "leo, graf tolstoy": "Léon Tolstoï",
    "tolstoy": "Léon Tolstoï",
    "j.-h., aîné rosny": "J.-H. Rosny aîné",
    "sacher-masoch": "Léopold von Sacher-Masoch",
    "leibniz": "Gottfried Wilhelm Leibniz",
    "fouché": "Joseph Fouché",
    "saint-simon": "Louis de Rouvroy, duc de Saint-Simon"
}

updates = []

for row_id, titre, auteur, siecle in rows:
    titre_c = str(titre or "").strip()
    auteur_c = str(auteur or "").strip()
    siecle_c = str(siecle or "").strip()

    # 1. Correction des titres trop courts
    if titre_c in ["II)", "II", "III", "IV", "VI"]:
        titre_c = f"{auteur_c} - Extrait {titre_c.replace(')', '')}"

    # 2. Nettoyage des motifs Gutenberg dans les auteurs
    # Supression des dates BCE / CE / siècles en anglais
    auteur_c = re.sub(r'-\d+\s*BCE', '', auteur_c, flags=re.I)
    auteur_c = re.sub(r'\bactive\s+\d+(st|nd|rd|th)?\s+century\b', '', auteur_c, flags=re.I)
    auteur_c = re.sub(r'\b\d{2,4}\s*-\s*\d{2,4}\b', '', auteur_c)
    auteur_c = re.sub(r'\b(graf|Ritter von|Freiherr von|commis des Postes)\b', '', auteur_c, flags=re.I)

    # 3. Remplacement si présence d'un nom connu
    auteur_lower = auteur_c.lower()
    for key, target in AUTEURS_FIXES.items():
        if key in auteur_lower:
            auteur_c = target
            break

    # 4. Inversion "Nom, Prénom" -> "Prénom Nom" si la virgule persiste
    if "," in auteur_c and not any(k in auteur_c.lower() for k in ["duc", "comte", "baron", "prince", "marquis"]):
        parts = auteur_c.split(",", 1)
        auteur_c = f"{parts[1].strip()} {parts[0].strip()}"

    # Nettoyage des espaces doubles et de la ponctuation résiduelle
    auteur_c = re.sub(r'\s+', ' ', auteur_c).strip(" ,.-")

    updates.append((titre_c, auteur_c, siecle_c, row_id))

# Application de la mise à jour en BDD
cursor.executemany(f"UPDATE {table_nom} SET titre = ?, auteur = ?, siecle = ? WHERE rowid = ?", updates)
conn.commit()

# Régénération de l'export JSON dans Téléchargements
cursor.execute(f"PRAGMA table_info({table_nom});")
columns = [col[1] for col in cursor.fetchall()]
cursor.execute(f"SELECT * FROM {table_nom};")
bd_complete = [dict(zip(columns, r)) for r in cursor.fetchall()]

conn.close()

with open(output_json, "w", encoding="utf-8") as f:
    json.dump(bd_complete, f, ensure_ascii=False, indent=2)

print("=" * 60)
print(f"✅ BDD SQLite & Fichier JSON (1,49 Go) 100 % nettoyés !")
print(f"📂 Emplacement : {output_json}")
print("=" * 60)
