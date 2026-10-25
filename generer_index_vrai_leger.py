import sqlite3
import json
import os

db_path = "oeuvres_nettoyee.db" if os.path.exists("oeuvres_nettoyee.db") else "oeuvres.db"
download_dir = "/sdcard/Download" if os.path.exists("/sdcard/Download") else os.path.expanduser("~/storage/downloads")
output_json_leger = os.path.join(download_dir, "nomad_library_index_4073_apercu.json")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [t[0] for t in cursor.fetchall() if t[0] != 'sqlite_sequence']
table_nom = tables[0]

cursor.execute(f"PRAGMA table_info({table_nom});")
columns = [col[1] for col in cursor.fetchall()]

cursor.execute(f"SELECT * FROM {table_nom};")
rows = cursor.fetchall()

index_leger = []

for row in rows:
    item = dict(zip(columns, row))
    notice_legere = {}
    
    for k, v in item.items():
        # Si le champ est une chaîne de texte long (texte intégral, contenu, html, etc.)
        if isinstance(v, str) and len(v) > 300:
            txt = v.strip()
            L = len(txt)
            debut = txt[:120]
            milieu = txt[L//2 - 60 : L//2 + 60]
            fin = txt[-120:]
            
            notice_legere[k + "_apercu"] = f"{debut} [...] [MILIEU] [...] {milieu} [...] [FIN] [...] {fin}"
            notice_legere["longueur_caracteres"] = L
        else:
            # Conservé tel quel (id, titre, auteur, siecle, categorie, etc.)
            notice_legere[k] = v
            
    index_leger.append(notice_legere)

conn.close()

# Écriture du fichier JSON très léger
with open(output_json_leger, "w", encoding="utf-8") as f:
    json.dump(index_leger, f, ensure_ascii=False, indent=2)

taille_ko = os.path.getsize(output_json_leger) / 1024
taille_mo = taille_ko / 1024

print("=" * 60)
print(f"📦 INDEX VRAIMENT LÉGER GÉNÉRÉ : {len(index_leger)} notices")
print(f"📂 Emplacement : {output_json_leger}")
print(f"⚖️ TAILLE RÉELLE DU FICHIER : {taille_mo:.2f} Mo ({taille_ko:.1f} Ko)")
print("=" * 60)

