# Nomad Pocket Library — Notes d'architecture

## Étape 1 (POC) : chaîne d'installation — VALIDÉE SUR APPAREIL RÉEL

Résultat mesuré sur Galaxy S21 Ultra (rapport Fabrice) : **import local de 20 segments
GZIP → décompression → écriture des 1,64 Go dans l'OPFS en 13 secondes**.

### Ce qui a changé depuis la première version du POC
- **XZ / LZMA preset 9 extrême abandonné.** Motif : `LZMA_MEMLIMIT_ERROR` (code 8 de
  liblzma) en WASM — le dictionnaire demandé dépasse la mémoire disponible au moteur
  de décompression sur mobile. Arbitrage assumé : **GZIP niveau 6 via pako**, 607 Mo
  compressés au lieu de 393 Mo, mais décompression instantanée et sans risque d'OOM.
  À 13 s d'installation pour 607 Mo, le surcoût de 214 Mo est indolore.
- **Manifeste tolérant** (`normalizeManifest`) : `chunks` accepte un tableau d'objets
  `{name, bytes, sha256}` **ou** un tableau de chaînes `["corpus_part_01.bin", …]`.
- **SHA-256 facultatif** : une empreinte absente n'est plus une erreur (`undefined.slice()`).
- **Découverte automatique de l'agencement GZIP** : un flux unique découpé en N segments
  (cas nominal) ou N flux indépendants. La détection se fait au premier segment, donc un
  éventuel second passage ne rejoue que ce segment.
- **Fin d'installation sans relecture de la base** : on compare la taille du fichier OPFS à
  `taille_brute_octets`. Aucun chargement des 1,64 Go en mémoire à aucun moment.

---

## Étape 2 : moteur SQLite — wa-sqlite + VFS OPFS lecture seule

### Diagnostic de l'échec de sql.js
`sql.js` exige un `ArrayBuffer` contigu de la taille de la base : 1 640 824 832 octets
alloués d'un bloc dans le tas WASM. Sur mobile, l'allocation échoue ou tue l'onglet
(« fetching of the wasm failed » était en réalité le symptôme d'une allocation impossible).
Ce n'était donc pas un problème de chargement du binaire mais **structurel**.

### Solution retenue
`wa-sqlite` + **VFS maison lecture seule** (`src/lib/vfs/ReadOnlyFileVFS.ts`), exécuté
dans un **Web Worker dédié** (`src/workers/db.worker.ts`).

Pourquoi un VFS maison alors que wa-sqlite fournit des exemples OPFS ?
1. **Les VFS concrets ne sont pas livrés dans le tarball npm 1.0.0** (le dossier
   `src/examples` est vide) et ceux du dépôt GitHub dépendent d'une `FacadeVFS` non publiée.
2. Notre besoin est un cas particulier très simple : **lire un fichier unique et
   immuable**. Un VFS de ~180 lignes sans écriture, sans journal, sans verrou
   multi-processus, sans fichier temporaire, est plus auditable qu'un VFS générique.

Conséquences directes :
- **La base ne peut pas être corrompue par l'application** : `xWrite`/`xTruncate`/`xDelete`
  renvoient `SQLITE_READONLY`, `xAccess` ne déclare jamais l'existence d'un journal, et le
  Worker applique `PRAGMA query_only = 1`.
- **Aucune allocation contiguë** : SQLite lit page par page (4 Ko) via
  `FileSystemSyncAccessHandle` (API disponible uniquement en Worker — c'est précisément
  pour cela que le moteur est isolé du thread principal).
- **Mémoire bornée** : `PRAGMA cache_size = -4096` (≈4 Mo de cache de pages) et
  `PRAGMA mmap_size = 0`. La consommation dépend du résultat de la requête, pas de la
  taille de la base.
- **Repli automatique** si `createSyncAccessHandle` est absent : lectures synchrones par
  `FileReaderSync` + `File.slice()` (fonctionne dans tout Worker, sans verrou exclusif).

### Mesures obtenues dans cet environnement (test `scripts/vfs-test-entry.ts`)
Base de test générée avec sql.js, **2 Mo, contenant une œuvre de 1,6 Mo de texte** afin de
forcer SQLite à chaîner des pages de débordement — la situation réelle de chaque ligne du
corpus de 1,64 Go.

| Opération | Résultat |
|---|---|
| Scan des métadonnées (colonnes avant `texte_integral`) | 2 œuvres en **1 ms** |
| `SELECT texte_integral … WHERE id = ?` (1,6 Mo de texte) | **33 ms**, octet pour octet identique |
| `PRAGMA page_size` / `max(rowid)` | 4096 / 2 |
| Tentative d'écriture | **refusée** par le VFS |

Ce test exécute le VFS de production et **le même binaire WASM** que celui livré au
navigateur. Commande : `npx esbuild scripts/vfs-test-entry.ts --bundle --platform=node
--format=esm --outfile=scripts/.vfs-test.mjs --external:sql.js --external:wa-sqlite
--external:wa-sqlite/dist/wa-sqlite.mjs --external:wa-sqlite/src/VFS.js && node scripts/.vfs-test.mjs`

### Le point de performance décisif : l'ordre des colonnes
Dans le schéma, `texte_integral` est en 9e position et `nb_mots`, `siecle`,
`mouvement_litteraire` sont stockés **après** le texte. SQLite stocke un enregistrement
en séquence : quand il déborde sur des pages de débordement, lire une colonne située
après le texte impose de suivre toute la chaîne de débordement.

D'où la règle appliquée partout dans le Worker :
- `getOeuvre(id)` : `SELECT … WHERE id = ?` → coût proportionnel à **la taille de l'œuvre**,
  jamais à celle de la base (lookup sur la clé primaire + chaîne de débordement).
- Scan de catalogue : **uniquement** les colonnes 1 à 8 → aucune page de débordement lue,
  donc ~20 Mo d'E/S pour 5 098 œuvres au lieu de 1,64 Go.
- **Jamais de `SELECT *` en masse**, jamais de `COUNT(*)` sur la table (cela balayerait
  tout le b-tree) — on utilise `max(rowid)`.

### Catalogue : index JSON d'abord, base ensuite
Les métadonnées riches (nombre de mots, siècle, mouvement) ne sont pas récupérables en
masse sans lire le texte. Le catalogue vient donc de `catalog_index.json` (2,5 Mo,
fourni par le backend), et le scan SQL n'est qu'un **repli** (métadonnées partielles).
L'index est mis en cache IndexedDB : navigation instantanée et hors-ligne.

Priorité : cache IndexedDB → `catalog_index.json` (URL du corpus ou fichier importé) →
scan SQL → vide. Le bouton « Reconstruire le catalogue depuis la base » de l'onglet
Stockage couvre le cas où l'index ne serait pas disponible.

### Répartition réelle thread principal / Worker
| Thread principal | Worker |
|---|---|
| Sélecteur de fichiers (`<input type="file">`) | OPFS **en lecture** via `SyncAccessHandle` |
| OPFS **en écriture** (`createWritable`) pendant l'installation | moteur wa-sqlite + VFS lecture seule |
| IndexedDB (données personnelles, catalogue en cache) | requêtes SQL paginées |
| `speechSynthesis`, `SpeechRecognition` | — |

Un `SyncAccessHandle` pose un **verrou exclusif** sur le fichier : le pipeline
d'installation appelle donc `dbClient.close()` avant d'écrire, et l'onglet Stockage
propose une suppression qui passe par le Worker.

### Empreinte de l'application
`dist/index.html` auto-contenu : **1,15 Mo (469 Ko gzip)**, moteur SQLite WASM inclus.
Le binaire était embarqué deux fois (744 Ko de base64 en trop) ; le Worker résout
désormais son propre WASM via l'URL de données insérée par le bundler, avec replis
explicites pour le développement. Le Service Worker met l'app shell en cache : après la
première visite, l'ouverture d'une œuvre installée ne déclenche **aucune** requête réseau.

---

## Hébergement et distribution : comparatif

| Option | Limite réelle | CORS mesuré | Verdict |
|---|---|---|---|
| **GitHub Pages (même origine que l'app)** | Site publié ≤ 1 Go ; fichier ≤ 100 Mo dans le dépôt | Sans objet (même origine) | ✅ **Recommandé.** App (~1,2 Mo) + 20 segments (607 Mo) + index ≈ 610 Mo, sous la limite. Aucun problème CORS par construction. |
| **GitHub Releases** | 2 Go par fichier, pas de comptage dans le quota du dépôt | ❌ **Aucun `Access-Control-Allow-Origin`**, même avec un en-tête `Origin` (vérifié) | ❌ **Inutilisable pour un `fetch()` direct** : le navigateur bloquera la lecture de la réponse. Reste utile uniquement comme source de téléchargement *manuel* vers l'appareil. |
| **`raw.githubusercontent.com` (fichiers d'un dépôt)** | Fichier ≤ 100 Mo ; pas conçu pour distribuer de gros binaires | ✅ `access-control-allow-origin: *` (vérifié) | 🟡 Valable en solution de repli si le site dépasse 1 Go. À valider sur appareil pour des segments de ~30 Mo. |
| **Import local depuis l'appareil** | Aucune limite applicative | Sans objet (API File) | ✅ **Déjà validé sur S21 Ultra** (13 s). Voie la plus souveraine, à conserver en priorité. |
| Google Drive en lien direct | Aucun CORS garanti, `content-disposition`, quotas | ❌ | ❌ Source de téléchargement manuel uniquement, jamais en `fetch()` direct. |
| Serveur payant (VPS, S3…) | Coût, maintenance | — | ❌ Contraire à l'objectif « zéro serveur obligatoire ». |

Recommandation concrète : **un seul dépôt GitHub Pages** contenant `dist/` de l'app **et** le
corpus (`manifest.json`, les 20 segments, `catalog_index.json`) — même origine, donc aucun
CORS à gérer. L'import local reste documenté comme procédure permanente et hors-ligne.

**Correction importante par rapport à la version précédente de ce document**, qui
recommandait GitHub Releases pour les segments : la mesure ci-dessus montre que les assets
de Release ne renvoient pas d'en-tête CORS. Un `fetch()` cross-origin aurait donc échoué
avec une erreur réseau silencieuse pour l'utilisateur. C'est exactement le type d'écart
entre « théoriquement possible » et « effectivement vérifié » que le cahier des charges
demande de distinguer.

Besoin de stockage côté appareil : 607 Mo de segments **temporaires** + 1,64 Go de base
décompressée + cache ≈ **2,3 Go** à prévoir. L'écran Stockage affiche
`navigator.storage.estimate()` et un bouton de demande de persistance
(`navigator.storage.persist()`), car Android peut sinon évacuer l'origine sous pression.

---

## Érgonomie livrée à l'Étape 2
- Navigation par barre d'onglets basse (bibliothèque, marque-pages, mes écrits,
  stockage, réglages) : atteignable au pouce, sans jargon technique.
- Recherche + filtres genre/siècle + tri, pagination de la liste.
- Lecteur : clic sur un paragraphe pour lire à partir de ce point, surlignage du
  paragraphe **et** de la phrase active, mini-lecteur flottant (lecture/pause,
  phrase précédente/suivante, débit 0,75×–2×, sélection de voix, extraction).
- **Fenêtrage du texte** : 120 paragraphes affichés par bloc. Une œuvre de 10 Mo ne
  charge jamais son DOM ni ses unités vocales en entier.
- Sommaire interactif (détection des titres, repli en blocs réguliers) + scrubber
  en pourcentage du texte.
- Marque-page automatique (position sauvegardée, carte « Reprendre la lecture ») et
  marque-pages manuels (extraits classés par auteur/titre, copie rapide).
- Éditeur d'œuvres personnelles + notes, dictée vocale si l'API est présente.
- Sauvegarde/restauration JSON complète des données personnelles.

## Reste à valider sur appareil réel
1. Ouverture d'une œuvre **longue** du vrai corpus (pas la démo) : temps de réponse et
   mémoire (à surveiller dans `chrome://inspect` → Memory).
2. Persistance OPFS après redémarrage complet du navigateur et du téléphone.
3. Mode avion intégral : catalogue, ouverture d'œuvre, lecture vocale avec une voix
   locale, reprise après pause.
4. Installation PWA sur l'écran d'accueil, puis comportement du Service Worker.
5. Quota insuffisant : vérifier le message explicite et le nettoyage automatique
   (la base partielle est supprimée en cas d'échec).
6. Dictée hors-ligne : dépend des packs de reconnaissance vocale installés sur l'appareil.

L'onglet Réglages → Diagnostic reflète cet état (validé sur S21 Ultra / validé ici /
partiel / à valider) et l'affiche à l'utilisateur final plutôt que de le cacher.
