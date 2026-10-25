import json
import re
import sys
import os

def nettoyer_metadonnees_et_bruit(notice):
    extrait_deb = notice.get("extrait_debut", "")
    extrait_fin = notice.get("extrait_fin", "")
    auteur = notice.get("auteur", "")
    
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
    siecle = notice.get("siecle", "")
    if siecle == "Moyen Âge / Ancien" and any(a in auteur_clean for a in auteurs_xixe_xxe):
        siecle = "XIXe/XXe siècle"

    anomalies = notice.get("anomalies_detectees", [])
    if is_english_mismatch:
        anomalies.append("Contenu hors-sujet / Langue anglaise")
    if bruit_web:
        anomalies.append("Bruit web / JavaScript résiduel")
        
    notice["anomalies_detectees"] = list(set(anomalies))
    notice["auteur"] = auteur_clean
    notice["siecle"] = siecle
    return notice

fichier_entree = "echantillon_300.json"
fichier_sortie = "echantillon_300_nettoye.json"

if not os.path.exists(fichier_entree):
    print(f"❌ Impossible de trouver {fichier_entree} dans ce dossier.")
    sys.exit(1)

with open(fichier_entree, "r", encoding="utf-8") as f:
    data = json.load(f)

if isinstance(data, list):
    data_nettoyee = [nettoyer_metadonnees_et_bruit(n) for n in data]
else:
    data_nettoyee = nettoyer_metadonnees_et_bruit(data)

with open(fichier_sortie, "w", encoding="utf-8") as f:
    json.dump(data_nettoyee, f, ensure_ascii=False, indent=2)

print(f"✅ Traitement terminé avec succès ! Fichier généré : {fichier_sortie}")
