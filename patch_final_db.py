import sqlite3
import re
import os

# 1. Cartographie élargie par mots-clés
MAP_MOTS_CLES = {
    "baudelaire": "XIXe siècle",
    "rimbaud": "XIXe siècle",
    "descartes": "XVIIe siècle",
    "bossuet": "XVIIe siècle",
    "chateaubriand": "XIXe siècle",
    "la fayette": "XVIIe siècle",
    "homer": "Antiquité / Ancien",
    "petronius": "Antiquité / Ancien",
    "franklin": "XVIIIe siècle",
    "erckmann": "XIXe siècle"
}

db_path = "oeuvres_nettoyee.db" if os.path.exists("oeuvres_nettoyee.db") else "oeuvres.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
table_nom = [t[0] for t in cursor.fetchall() if t[0] != 'sqlite_sequence'][0]

cursor.execute(f"SELECT rowid, titre, auteur, siecle FROM {table_nom};")
rows = cursor.fetchall()

updates = []
for row_id, titre, auteur, siecle in rows:
    titre_c = str(titre or "").strip()
    auteur_c = str(auteur or "").strip()
    siecle_c = str(siecle or "").strip()

    # Nettoyage des dates antiques/bibliographiques dans l'auteur (ex: "751 BCE-651 BCE Homer")
    auteur_c = re.sub(r"^\d+.*?\bBCE\b\s*", "", auteur_c, flags=re.I)
    auteur_c = re.sub(r"^\d+-\d+\s+", "", auteur_c)
    
    # Inversion "Nom, Prénom" -> "Prénom Nom" (ex: "Ségur, Sophie..." -> "Sophie Ségur...")
    if "," in auteur_c and not any(k in auteur_c.lower() for k in ["baron", "comte", "prince", "king", "duchesse"]):
        parts = auteur_c.split(",", 1)
        auteur_c = f"{parts[1].strip()} {parts[0].strip()}"

    # Réalignement du siècle par mot-clé auteur
    for kw, s_target in MAP_MOTS_CLES.items():
        if kw in auteur_c.lower():
            siecle_c = s_target
            break

    # Correction des titres vides ou invalides
    if not titre_c or len(titre_c) <= 2:
        titre_c = "Sans titre (Extrait)"

    updates.append((titre_c, auteur_c, siecle_c, row_id))

cursor.executemany(f"UPDATE {table_nom} SET titre = ?, auteur = ?, siecle = ? WHERE rowid = ?", updates)
conn.commit()
conn.close()
print(f"✅ Patch final appliqué sur {len(updates)} notices.")

