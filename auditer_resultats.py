import json

with open("echantillon_300_nettoye.json", "r", encoding="utf-8") as f:
    data = json.load(f)

print(f"\n==========================================")
print(f"   RAPPORT D'AUDIT SUR {len(data)} NOTICES NETTOYÉES")
print(f"==========================================\n")

anomalies_counts = {}
siecles_recalcules = 0

for n in data:
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
for n in data[:5]:
    print(f"Titre     : {n.get('titre')}")
    print(f"Auteur    : {n.get('auteur')}")
    print(f"Siècle    : {n.get('siecle')}")
    print(f"Anomalies : {n.get('anomalies_detectees')}")
    print("-" * 42)
