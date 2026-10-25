import sqlite3
import json
import os
import zlib
import hashlib

DB_FILE = "oeuvres.db"
INDEX_FILE = [f for f in os.listdir('.') if 'apercu.json' in f][0]
DIST_DIR = "dist"

os.makedirs(DIST_DIR, exist_ok=True)

# 1. Charger la liste stricte des 4 073 œuvres nettoyées
print(f"Chargement de l'index nettoyé : {INDEX_FILE}...")
with open(INDEX_FILE, 'r', encoding='utf-8') as f:
    clean_index = json.load(f)

# Extraction des IDs / Titres autorisés
clean_ids = set()
clean_titles = set()
for item in clean_index:
    if 'id' in item and item['id']:
        clean_ids.add(str(item['id']))
    if 'titre' in item and item['titre']:
        clean_titles.add(str(item['titre']))

print(f"Nombre d'œuvres autorisées dans l'index : {len(clean_index)}")

# 2. Extraction filtrée depuis SQLite
conn = sqlite3.connect(DB_FILE)
cursor = conn.cursor()
cursor.execute("SELECT id, titre, auteur, dates_auteur, type_genre, categories_tags, tome, sources_disponibles, texte_integral, nb_mots, nb_caracteres, temps_lecture_min, siecle, mouvement_litteraire FROM oeuvres")

oeuvres_clean = []
for row in cursor.fetchall():
    row_id = str(row[0]) if row[0] else ""
    row_title = str(row[1]) if row[1] else ""
    
    # Filtrage strict : l'œuvre doit être présente dans l'index d'aperçu
    if row_id in clean_ids or row_title in clean_titles:
        oeuvres_clean.append({
            "id": row[0],
            "titre": row[1],
            "auteur": row[2],
            "dates_auteur": row[3],
            "type_genre": row[4],
            "categories_tags": row[5],
            "tome": row[6],
            "sources_disponibles": row[7],
            "texte_integral": row[8],
            "nb_mots": row[9],
            "nb_caracteres": row[10],
            "temps_lecture_min": row[11],
            "siecle": row[12],
            "mouvement_litteraire": row[13]
        })

conn.close()

print(f"Œuvres extraites et validées : {len(oeuvres_clean)}")

# 3. Découpage et compression en paquets .bin
MAX_CHUNK_SIZE = 3 * 1024 * 1024  # Paquets de ~3 Mo
current_chunk = []
current_size = 0
part_index = 0
manifest_parts = []

for oeuvre in oeuvres_clean:
    payload = json.dumps(oeuvre, ensure_ascii=False).encode('utf-8')
    payload_compressed = zlib.compress(payload)
    
    if current_size + len(payload_compressed) > MAX_CHUNK_SIZE and current_chunk:
        # Écriture du paquet .bin
        bin_filename = f"corpus_part_{part_index}.bin"
        bin_path = os.path.join(DIST_DIR, bin_filename)
        
        chunk_bytes = b"".join(current_chunk)
        with open(bin_path, 'wb') as f_bin:
            f_bin.write(chunk_bytes)
            
        sha256_hash = hashlib.sha256(chunk_bytes).hexdigest()
        manifest_parts.append({
            "filename": bin_filename,
            "size": len(chunk_bytes),
            "sha256": sha256_hash,
            "count": len(current_chunk)
        })
        
        part_index += 1
        current_chunk = []
        current_size = 0
        
    current_chunk.append(payload_compressed)
    current_size += len(payload_compressed)

if current_chunk:
    bin_filename = f"corpus_part_{part_index}.bin"
    bin_path = os.path.join(DIST_DIR, bin_filename)
    chunk_bytes = b"".join(current_chunk)
    with open(bin_path, 'wb') as f_bin:
        f_bin.write(chunk_bytes)
        
    sha256_hash = hashlib.sha256(chunk_bytes).hexdigest()
    manifest_parts.append({
        "filename": bin_filename,
        "size": len(chunk_bytes),
        "sha256": sha256_hash,
        "count": len(current_chunk)
    })

# Écriture du manifest
manifest = {
    "total_oeuvres": len(oeuvres_clean),
    "total_parts": len(manifest_parts),
    "parts": manifest_parts
}

with open(os.path.join(DIST_DIR, "manifest.json"), 'w', encoding='utf-8') as f_man:
    json.dump(manifest, f_man, ensure_ascii=False, indent=2)

print(f"\nASSEMBLAGE STRICT TERMINÉ : {len(oeuvres_clean)} œuvres réparties dans {len(manifest_parts)} paquets .bin")
