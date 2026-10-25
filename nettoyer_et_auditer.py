import json
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
        anomalies = []
        
    if is_english_mismatch:
        anomalies.append("Contenu hors-sujet / Langue anglaise")
    if bruit_web:
        anomalies.append("Bruit web / JavaScript résiduel")
        
    notice["anomalies_detectees"] = list(set(anomalies))
    notice["auteur"] = auteur_clean
    notice["siecle"] = siecle
    return notice

# Source & Destination
fichier_entree = "echantillon_300.json"
fichier_sortie = "echantillon_300_nettoye.json"

if not os.path.exists(fichier_entree):
    print(f"❌ Impossible de trouver {fichier_entree} dans ce dossier.")
    exit(1)

with open(fichier_entree, "r", encoding="utf-8") as f:
    data = json.load(f)

# Adaptation automatique à la structure JSON
notices_list = []
if isinstance(data, list):
    notices_list = [nettoyer_metadonnees_et_bruit(item) for item in data]
    data_nettoyee = notices_list
elif isinstance(data, dict):
    cle_liste = None
    for k in ["notices", "oeuvres", "data", "items", "results"]:
        if k in data and isinstance(data[k], list):
            cle_liste = k
            break
            
    if cle_liste:
        data[cle_liste] = [nettoyer_metadonnees_et_bruit(item) for item in data[cle_liste]]
        notices_list = data[cle_liste]
        data_nettoyee = data
    else:
        data_nettoyee = {}
        for k, v in data.items():
            if isinstance(v, dict):
                v_nettoye = nettoyer_metadonnees_et_bruit(v)
                data_nettoyee[k] = v_nettoye
                notices_list.append(v_nettoye)
            else:
                data_nettoyee[k] = v

with open(fichier_sortie, "w", encoding="utf-8") as f:
    json.dump(data_nettoyee, f, ensure_ascii=False, indent=2)

# Audit de contrôle imprimé à l'écran
print("\n==========================================")
print(f"   RAPPORT D'AUDIT SUR {len(notices_list)} NOTICES TRAITÉES")
print("==========================================\n")

anomalies_counts = {}
siecles_recalcules = 0

for n in notices_list:
    if isinstance(n, dict):
        anoms = n.get("anomalies_detectees", [])
        for a in anoms:
            anomalies_counts[a] = anomalies_counts.get(a, 0) + 1
        if n.get("siecle") == "XIXe/XXe siècle":
            siecles_recalcules += 1

print("1. DESTRUCTION DU BRUIT ET ANOMALIES DÉTECTÉES :")
if anomalies_counts:
    for k, v in anomalies_counts.items():
        print(f"   • {k} : {v} fiches identifiées")
else:
    print("   • Aucune anomalie détectée.")

print(f"\n2. RÉALIGNEMENT DES SIÈCLES :")
print(f"   • Fiches corrigées vers 'XIXe/XXe siècle' : {siecles_recalcules}")

print(f"\n3. EXTRAIT DE CONTRÔLE (5 PREMIÈRES NOTICES) :")
print("-" * 42)
for n in notices_list[:5]:
    if isinstance(n, dict):
        print(f"Titre     : {n.get('titre', 'N/A')}")
        print(f"Auteur    : {n.get('auteur', 'N/A')}")
        print(f"Siècle    : {n.get('siecle', 'N/A')}")
        print(f"Anomalies : {n.get('anomalies_detectees', [])}")
        print("-" * 42)

# Export automatique vers vos Téléchargements
dst1 = "/sdcard/Download/echantillon_300_nettoye.json"
dst2 = os.path.expanduser("~/storage/downloads/echantillon_300_nettoye.json")

try:
    shutil.copy(fichier_sortie, dst1)
    print(f"\n✅ Fichier copié dans Téléchargements : {fichier_sortie}")
except Exception:
    try:
        shutil.copy(fichier_sortie, dst2)
        print(f"\n✅ Fichier copié dans Téléchargements : {fichier_sortie}")
    except Exception:
        print(f"\n⚠️ Fichier disponible localement dans : {fichier_sortie}")

