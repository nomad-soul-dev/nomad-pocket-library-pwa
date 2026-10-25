import sqlite3
import json
import os

# 1. BDDs à cibler
db_sources = [f for f in ["oeuvres_nettoyee.db", "oeuvres.db"] if os.path.exists(f)]
download_dir = "/sdcard/Download" if os.path.exists("/sdcard/Download") else os.path.expanduser("~/storage/downloads")
output_json_leger = os.path.join(download_dir, "nomad_library_index_4073_apercu.json")

if not db_sources:
    print("❌ Aucune base de données SQLite trouvée.")
    exit()

db_path = db_sources[0]
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Récupération de la table
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
    
    # Identification du champ contenant le texte/extrait principal
    texte_complet = ""
    champ_texte_cle = None
    for cle in ["texte", "contenu", "extrait", "text", "body"]:
        if cle in item and item[cle]:
            texte_complet = str(item[cle]).strip()
            champ_texte_cle = cle
            break
            
    longueur_totale = len(texte_complet)
    
    # Échantillonnage : Début (150 chars) + Milieu (150 chars) + Fin (150 chars)
    if longueur_totale > 450:
        debut = texte_complet[:150]
        idx_milieu = longueur_totale // 2
        milieu = texte_complet[idx_milieu - 75 : idx_milieu + 75]
        fin = texte_complet[-150:]
        apercu_texte = f"{debut}\n\n[...] [MILIEU] [...]\n\n{milieu}\n\n[...] [FIN] [...]\n\n{fin}"
    else:
        apercu_texte = texte_complet

    # Remplacement du texte intégral par l'aperçu dans la notice
    item_leger = dict(item)
    if champ_texte_cle:
        item_leger[champ_texte_cle] = apercu_texte
    
    item_leger["longueur_caracteres"] = longueur_totale
    index_leger.append(item_leger)

conn.close()

# Si deux fichiers DB existent, on copie oeuvres_nettoyee.db vers oeuvres.db pour parfaite synchro
if len(db_sources) > 1 and "oeuvres_nettoyee.db" in db_sources and "oeuvres.db" in db_sources:
    import shutil
    shutil.copyfile("oeuvres_nettoyee.db", "oeuvres.db")
    print("🔄 Synchronization effectuée : 'oeuvres_nettoyee.db' -> 'oeuvres.db'")

# Sauvegarde du fichier JSON léger
with open(output_json_leger, "w", encoding="utf-8") as f:
    json.dump(index_leger, f, ensure_ascii=False, indent=2)

taille_mo = os.path.getsize(output_json_leger) / (1024 * 1024)

print("=" * 60)
print(f"✅ BDD SQLite synchronisées.")
print(f"📦 INDEX LÉGER INTÉGRAL CRÉÉ : {len(index_leger)} notices")
print(f"📂 Fichier disponible : {output_json_leger}")
print(f"⚖️ Taille finale du fichier : {taille_mo:.2f} Mo")
print("=" * 60)

