import json
import sqlite3
import re
import os
import shutil

def nettoyer_metadonnees_et_bruit(notice):
    if not isinstance(notice, dict):
        return notice
        
    extrait_deb = str(notice.get("extrait_debut", ""))
    extrait_fin = str(notice.get("extrait_fin", ""))
    auteur = str(notice.get("auteur", ""))
    
    # 1. Détection de pollution linguistique / Mismatch de texte
    mots_cles_anglais = [r"\bProduced by\b", r"\bEnd of Project Gutenberg\b", r"\bTRANSLATED INTO ENGLISH\b", r"\bCONTENTS\b", r"\bTHE END\b"]
    is_english_mismatch = sum(bool(re.search(pat, extrait_deb + extrait_fin, re.I)) for pat in mots_cles_anglais) >= 2
    
    # 2. Détection de bruit web / JS (Wikisource & Archive.org)
    bruit_web = bool(re.search(r"(function\s*\(|addEventListener|client-js|@licstart|archive_analytics|Full text of)", extrait_deb + extrait_fin))
    
    # 3. Nettoyage chirurgical de l'auteur
    auteur_clean = re.sub(r"\s*-\d{4}\s*", " ", auteur)
    auteur_clean = re.sub(r"\s*\d+\s*BCE\s*-\s*\d+\s*BCE\s*", " ", auteur_clean)
    auteur_clean = re.sub(r"\s*\?\s*", " ", auteur_clean)
    auteur_clean = re.sub(r"^(Classique / domaine public|Anonymous)$", "Anonyme", auteur_clean).strip()
    
    # 4. Invalidation des faux "Moyen Âge / Ancien"
    auteurs_xixe_xxe = ["Maupassant", "Jules Verne", "Jules Renard", "Stendhal", "George Sand", "Breton", "Farrère", "Michelet"]
    siecle = str(notice.get("siecle", ""))
    if siecle == "Moyen Âge / Ancien" and any(a in auteur_clean for a in auteurs_xixe_xxe):
        siecle = "XIXe/XXe siècle"

    anomalies = notice.get("anomalies_detectees", [])
    if not isinstance(anomalies, list):
        if isinstance(anomalies, str) and anomalies:
            anomalies = [anomalies]
        else:
            anomalies = []
        
    if is_english_mismatch:
        anomalies.append("Contenu hors-sujet / Langue anglaise")
    if bruit_web:
        anomalies.append("Bruit web / JavaScript résiduel")
        
    notice["anomalies_detectees"] = list(set(anomalies))
    notice["auteur"] = auteur_clean
    notice["siecle"] = siecle
    return notice

print("==================================================")
print("     TRAITEMENT GLOBAL DE LA BASE DE DONNÉES      ")
print("==================================================\n")

# Traitement SQLite if oeuvres.db exists
if os.path.exists("oeuvres.db"):
    print("📦 Base SQLite 'oeuvres.db' détectée. Traitement en cours...")
    shutil.copy("oeuvres.db", "oeuvres_nettoyee.db")
    conn = sqlite3.connect("oeuvres_nettoyee.db")
    cursor = conn.cursor()
    
    # Obtenir la liste des tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [t[0] for t in cursor.fetchall() if t[0] != 'sqlite_sequence']
    
    total_traite = 0
    for table in tables:
        cursor.execute(f"PRAGMA table_info({table});")
        cols = [c[1] for c in cursor.fetchall()]
        
        if "auteur" in cols:
            cursor.execute(f"SELECT rowid, * FROM {table};")
            rows = cursor.fetchall()
            
            for row in rows:
                row_id = row[0]
                row_dict = dict(zip(cols, row[1:]))
                
                # Adaptation du champ anomalies s'il existe sous forme de texte/JSON
                if "anomalies_detectees" in row_dict and isinstance(row_dict["anomalies_detectees"], str):
                    try:
                        row_dict["anomalies_detectees"] = json.loads(row_dict["anomalies_detectees"])
                    except:
                        row_dict["anomalies_detectees"] = []
                
                row_nettoye = nettoyer_metadonnees_et_bruit(row_dict)
                
                # Mise à jour des champs dans la base
                anom_str = json.dumps(row_nettoye.get("anomalies_detectees", []), ensure_ascii=False)
                
                update_query = f"""
                    UPDATE {table} 
                    SET auteur = ?, siecle = ?
                    {', anomalies_detectees = ?' if 'anomalies_detectees' in cols else ''}
                    WHERE rowid = ?
                """
                params = [row_nettoye["auteur"], row_nettoye["siecle"]]
                if 'anomalies_detectees' in cols:
                    params.append(anom_str)
                params.append(row_id)
                
                cursor.execute(update_query, params)
                total_traite += 1
                
    conn.commit()
    conn.close()
    print(f"✅ Base SQLite nettoyée avec succès ({total_traite} entrées mises à jour) : oeuvres_nettoyee.db")
    
    # Export de la base SQLite corrigée vers Téléchargements
    for dst in ["/sdcard/Download/oeuvres_nettoyee.db", os.path.expanduser("~/storage/downloads/oeuvres_nettoyee.db")]:
        try:
            shutil.copy("oeuvres_nettoyee.db", dst)
            print(f"📲 Fichier copié dans vos Téléchargements : {dst}")
            break
        except Exception:
            pass

# Traitement des fichiers JSON globaux le cas échéant
fichiers_json = [f for f in os.listdir(".") if f.endswith(".json") and "echantillon" not in f and "package" not in f and "tsconfig" not in f]

for f_json in fichiers_json:
    print(f"\n📄 Fichier JSON '{f_json}' détecté. Traitement en cours...")
    try:
        with open(f_json, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        if isinstance(data, list):
            data_nettoyee = [nettoyer_metadonnees_et_bruit(item) for item in data]
        elif isinstance(data, dict):
            data_nettoyee = {k: nettoyer_metadonnees_et_bruit(v) if isinstance(v, dict) else v for k, v in data.items()}
            
        out_name = f_json.replace(".json", "_nettoye.json")
        with open(out_name, "w", encoding="utf-8") as f:
            json.dump(data_nettoyee, f, ensure_ascii=False, indent=2)
            
        print(f"✅ Fichier JSON nettoyé avec succès : {out_name}")
        
        for dst in [f"/sdcard/Download/{out_name}", os.path.expanduser(f"~/storage/downloads/{out_name}")]:
            try:
                shutil.copy(out_name, dst)
                print(f"📲 Fichier copié dans vos Téléchargements : {dst}")
                break
            except Exception:
                pass
    except Exception as e:
        print(f"⚠️ Erreur lors du traitement de {f_json} : {e}")

