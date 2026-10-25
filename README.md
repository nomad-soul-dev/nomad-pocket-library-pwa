# Nomad Pocket Library — Guide de build et de déploiement

Liseuse PWA hors-ligne pour un corpus littéraire français du domaine public
(5 098 œuvres, base SQLite de 1,64 Go compressée en GZIP). Aucun serveur
obligatoire, aucune donnée personnelle transmise.

---

## 1. Construire l'application

```bash
npm install
npm run build          # produit dist/
```

`dist/index.html` est **auto-contenu** (1,15 Mo / 469 Ko gzip) : moteur SQLite
WASM et interface inclus. Seuls le corpus, les icônes et le Service Worker sont
des fichiers séparés.

Régénérer le corpus de démonstration (10 œuvres, ~30 Ko) utilisé pour les tests :

```bash
node scripts/build-demo-corpus.mjs
```

## 2. Produire le manifeste du corpus réel

À partir du dossier contenant tes 20 segments GZIP (`dist_github_gzip`) :

```bash
node scripts/build-corpus-manifest.mjs ./dist_github_gzip \
  --projet "Nomad Pocket Library Extreme" \
  --version 1.0.0 \
  --algo "gzip (pako, niveau 6)"
```

Le script :
- classe les segments dans l'ordre numérique exact (`part_02` avant `part_10`) ;
- calcule la taille et l'empreinte **SHA-256** de chacun (vérifiées par l'appli
  avant décompression : un téléchargement interrompu est détecté immédiatement) ;
- **lit la taille décompressée dans le trailer GZIP** du dernier segment
  (ISIZE) : 1 640 824 832 octets sont obtenus sans avoir besoin de la base ;
- détecte s'il s'agit d'un flux unique découpé ou de flux indépendants (l'appli
  gère les deux automatiquement).

## 3. Où héberger — résultats mesurés, pas supposés

| Hébergement | CORS | Conclusion |
|---|---|---|
| **GitHub Pages, même site que l'appli** | sans objet | ✅ **à privilégier** |
| GitHub Releases | ❌ aucun `Access-Control-Allow-Origin` (vérifié au `curl` avec en-tête `Origin`) | ne fonctionne **pas** en `fetch()` direct |
| `raw.githubusercontent.com/<user>/<repo>/main` | ✅ `access-control-allow-origin: *` | repli acceptable |
| Import local (fichiers sur le téléphone) | sans objet | ✅ validé sur Galaxy S21 Ultra (1,64 Go en 13 s) |

### Mise en place recommandée (un seul dépôt)

```
nomad-pocket-library/            ← dépôt GitHub, source du site GitHub Pages
├── index.html                   ← dist/index.html
├── manifest.webmanifest
├── sw.js
├── icons/icon-512.png
├── corpus/
│   ├── manifest.json            ← généré à l'étape 2
│   ├── corpus_part_01.bin … corpus_part_20.bin   (607 Mo au total)
│   └── catalog_index.json       ← 2,5 Mo, métadonnées complètes
└── demo-corpus/                 ← facultatif (corpus de démonstration)
```

Puis, dans l'application : **Stockage → « URL du corpus »** →
`https://<compte>.github.io/nomad-pocket-library/corpus`

La valeur est mémorisée sur l'appareil ; elle sert aussi à trouver
`catalog_index.json`. Le corpus de démonstration reste disponible sur
`/demo-corpus` pour les tests.

### Procédure sans réseau (toujours disponible)

1. Copier `manifest.json`, les 20 `.bin` et `catalog_index.json` sur le téléphone
   (Drive, câble, n'importe quel moyen).
2. Dans l'appli : **Stockage → « Importer depuis l'appareil »** et sélectionner
   tous les fichiers en une fois.
3. Vérifier dans l'onglet Stockage que la taille de la base installée correspond
   au manifeste.

## 4. Installation sur le téléphone

Ouvrir l'URL du site dans Chrome Android : une discrète invitation
« Installer la bibliothèque » apparaît (elle n'est proposée que lorsque le
navigateur le permet, et se réessaie après 30 jours si elle est écartée).
Le bouton classique de Chrome (⋮ → *Ajouter à l'écran d'accueil*) fonctionne
aussi. Une fois installée, l'appli démarre en plein écran, hors-ligne.

## 5. Tests automatisés disponibles

```bash
# VFS lecture seule + wa-sqlite : base de test avec pages de débordement
npx esbuild scripts/vfs-test-entry.ts --bundle --platform=node --format=esm \
  --outfile=scripts/.t.mjs --external:sql.js --external:wa-sqlite \
  --external:wa-sqlite/dist/wa-sqlite.mjs --external:wa-sqlite/src/VFS.js \
  && node scripts/.t.mjs && rm scripts/.t.mjs

# Bout en bout sur le corpus de démonstration livré :
# manifeste → SHA-256 → décompression → VFS → scan catalogue → lectures par clé
npx esbuild scripts/e2e-test-entry.ts --bundle --platform=node --format=esm \
  --outfile=scripts/.t.mjs --external:pako --external:wa-sqlite \
  --external:wa-sqlite/dist/wa-sqlite.mjs --external:wa-sqlite/src/VFS.js \
  && node scripts/.t.mjs && rm scripts/.t.mjs
```

## 6. Protocole de validation sur appareil réel

À dérouler sur le Galaxy S21 Ultra cible (l'onglet **Réglages → Diagnostic**
affiche l'état en temps réel) :

1. **Installation** de la PWA sur l'écran d'accueil, puis lancement depuis l'icône.
2. **Installation du corpus réel** (607 Mo) : durée, puis message de taille
   conforme au manifeste.
3. **Ouverture d'une œuvre longue** (ex. un roman complet) : temps de réponse.
4. **Mémoire** : `chrome://inspect` → onglet → Memory. La consommation doit rester
   de l'ordre de quelques dizaines de Mo, jamais de l'ordre du Go.
5. **Lecture vocale** : lecture, pause, reprise, saut sur un autre paragraphe,
   vitesse 1,5×, avec une voix française locale.
6. **Mode avion intégral** : tuer l'appli, réactiver le mode avion, rouvrir — le
   catalogue, l'œuvre en cours et la lecture vocale doivent fonctionner.
7. **Redémarrage du téléphone**, puis réouverture : persistance de l'OPFS.
8. **Marque-pages + sauvegarde** : créer un extrait, exporter
   `nomad_pocket_backup.json`, le réimporter.
9. **Espace insuffisant** (simuler en remplissant le stockage) : message explicite
   et nettoyage automatique de la base partielle.

## 7. Structure du code

```
src/
├── lib/vfs/ReadOnlyFileVFS.ts   VFS SQLite lecture seule (aucune écriture possible)
├── workers/db.worker.ts         moteur wa-sqlite + OPFS via SyncAccessHandle
├── lib/db-client.ts             proxy typé vers le Worker
├── lib/corpus.ts                pipeline d'installation (SHA-256, GZIP, OPFS)
├── lib/catalog.ts               catalogue (index JSON, scan SQL, cache signé)
├── lib/storage.ts               IndexedDB : données personnelles
├── lib/tts.ts                   synthèse vocale granularité phrase
├── lib/text.ts                  paragraphes, sommaire, phrases, fenêtrage
└── components/                  interface (bibliothèque, lecteur, réglages…)
```

Voir `ARCHITECTURE.md` pour les arbitrages détaillés (pourquoi wa-sqlite + VFS
maison plutôt que sql.js, ordre des colonnes du schéma, bornage mémoire, etc.).
