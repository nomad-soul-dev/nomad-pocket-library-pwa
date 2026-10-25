#!/usr/bin/env node
/**
 * Générateur de manifeste pour le corpus réel — Nomad Pocket Library
 *
 * Usage :
 *   node scripts/build-corpus-manifest.mjs <dossier_des_segments> [options]
 *
 * Options :
 *   --out <fichier>        chemin du manifeste à écrire (défaut : <dossier>/manifest.json)
 *   --projet "<nom>"       valeur de nom_projet
 *   --version "<x.y.z>"    valeur de version
 *   --algo "<texte>"       description de la compression
 *   --raw-size <octets>    impose la taille décompressée (si le flux n'est pas du GZIP)
 *   --note "<texte>"       commentaire libre embarqué dans le manifeste
 *
 * Ce que le script fait, et pourquoi :
 *   1. Recense les segments corpus_part_*.bin dans l'ordre numérique exact
 *      (corpus_part_02 doit venir après corpus_part_01, pas après corpus_part_10).
 *   2. Calcule la taille ET l'empreinte SHA-256 de chaque segment : l'application
 *      vérifie chaque empreinte avant décompression, ce qui détecte un téléchargement
 *      interrompu ou un fichier corrompu avant d'écrire 1,64 Go dans l'OPFS.
 *   3. Lit le TRAILER GZIP du dernier segment (CRC32 + ISIZE, 4 octets chacun en
 *      petit-boutiste). ISIZE contient la taille décompressée modulo 2^32 : tant que
 *      la base fait moins de 4 Go — c'est le cas de 1 640 824 832 octets — la valeur
 *      est EXACTE. On obtient donc `taille_brute_octets` sans avoir besoin de la base.
 *      L'application s'en sert comme contrôle final d'intégrité après installation.
 *   4. Détecte si chaque segment porte son propre en-tête GZIP (flux indépendants)
 *      ou s'il s'agit d'un flux unique découpé : l'application gère les deux cas
 *      automatiquement, mais l'information est précieuse pour le diagnostic.
 *
 * Exemple concret (corpus GZIP réel, 20 segments) :
 *   node scripts/build-corpus-manifest.mjs ./dist_github_gzip \
 *     --projet "Nomad Pocket Library Extreme" --version 1.0.0 \
 *     --algo "gzip (pako, niveau 6)"
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { _: [], out: null, projet: null, version: null, algo: null, rawSize: null, note: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--out") args.out = argv[++i];
    else if (value === "--projet") args.projet = argv[++i];
    else if (value === "--version") args.version = argv[++i];
    else if (value === "--algo") args.algo = argv[++i];
    else if (value === "--raw-size") args.rawSize = Number(argv[++i]);
    else if (value === "--note") args.note = argv[++i];
    else if (value === "--help" || value === "-h") args.help = true;
    else args._.push(value);
  }
  return args;
}

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} Mo`;
  return `${(n / 1024 ** 3).toFixed(3)} Go`;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args._.length === 0) {
  console.log("Usage : node scripts/build-corpus-manifest.mjs <dossier> [--out f] [--projet n] [--version v] [--algo a] [--raw-size o] [--note t]");
  process.exit(args.help ? 0 : 1);
}

const dir = path.resolve(args._[0]);
if (!existsSync(dir)) {
  console.error(`✗ Dossier introuvable : ${dir}`);
  process.exit(1);
}

// Tri numérique strict : part_02 avant part_10.
const chunkNames = readdirSync(dir)
  .filter((name) => /^corpus_part_\d+\.bin$/i.test(name))
  .sort((a, b) => {
    const na = Number(a.match(/(\d+)/)[1]);
    const nb = Number(b.match(/(\d+)/)[1]);
    return na - nb;
  });

if (chunkNames.length === 0) {
  console.error(`✗ Aucun fichier corpus_part_*.bin dans ${dir}`);
  process.exit(1);
}

console.log(`→ Analyse de ${chunkNames.length} segment(s) dans ${dir}\n`);

const chunks = [];
let compressedTotal = 0;
let perChunkStreams = 0;

chunkNames.forEach((name, index) => {
  const filePath = path.join(dir, name);
  const size = statSync(filePath).size;
  const bytes = readFileSync(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const hasGzipHeader = bytes.subarray(0, 2).equals(GZIP_MAGIC);
  if (hasGzipHeader) perChunkStreams += 1;

  chunks.push({ name, bytes: size, sha256, gzip: hasGzipHeader });
  compressedTotal += size;

  const isLast = index === chunkNames.length - 1;
  console.log(
    `  ${isLast ? "└─" : "├─"} ${name}  ${formatBytes(size).padStart(11)}  ${sha256.slice(0, 16)}…${
      hasGzipHeader ? "  [en-tête GZIP]" : ""
    }`
  );
});

// Taille décompressée : ISIZE du trailer GZIP du dernier segment (modulo 2^32).
let rawSize = 0;
const lastBytes = readFileSync(path.join(dir, chunkNames[chunkNames.length - 1]));
if (lastBytes.length >= 8) {
  const trailer = lastBytes.subarray(lastBytes.length - 8);
  const isize = trailer.readUInt32LE(4);
  if (isize > 0) rawSize = isize;
}
if (args.rawSize && Number.isFinite(args.rawSize)) {
  if (rawSize && rawSize !== args.rawSize) {
    console.error(
      `\n⚠️  Conflit de taille décompressée : trailer GZIP = ${rawSize}, --raw-size = ${args.rawSize}. La valeur explicite est retenue.`
    );
  }
  rawSize = args.rawSize;
}

const manifest = {
  nom_projet: args.projet ?? "Nomad Pocket Library",
  version: args.version ?? "1.0.0",
  algo_compression: args.algo ?? "gzip",
  taille_brute_octets: rawSize,
  taille_compresse_octets: compressedTotal,
  nombre_chunks: chunks.length,
  layout_gzip:
    perChunkStreams === chunkNames.length
      ? "segments-autonomes"
      : perChunkStreams === 1
        ? "flux-unique-decoupe"
        : "indetermine",
  chunks: chunks.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
  generated_at: new Date().toISOString(),
  note:
    args.note ??
    "Manifeste généré par scripts/build-corpus-manifest.mjs. Chaque empreinte SHA-256 est vérifiée par l'application avant décompression.",
};

const outPath = path.resolve(args.out ?? path.join(dir, "manifest.json"));
writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log("\n═══ RÉCAPITULATIF ═══");
console.log(`  Segments            : ${chunks.length}`);
console.log(`  Taille compressée   : ${compressedTotal.toLocaleString("fr-FR")} octets (${formatBytes(compressedTotal)})`);
console.log(
  rawSize
    ? `  Taille décompressée  : ${rawSize.toLocaleString("fr-FR")} octets (${formatBytes(rawSize)}) — lue dans le trailer GZIP`
    : `  Taille décompressée  : INCONNUE — relancez avec --raw-size 1640824832`
);
console.log(
  `  Agencement GZIP      : ${
    manifest.layout_gzip === "flux-unique-decoupe"
      ? "un seul flux découpé en segments"
      : manifest.layout_gzip === "segments-autonomes"
        ? "un flux GZIP indépendant par segment"
        : "non déterminé"
  }`
);
console.log(`  Manifeste écrit      : ${outPath}`);

console.log(
  `\n→ Dans l'application (onglet Stockage), indiquez l'URL qui contiendra manifest.json et les segments,`
);
console.log(
  `  par exemple : https://<compte>.github.io/nomad-corpus  ou  https://github.com/<compte>/<depot>/releases/download/v1.0.0`
);
console.log(
  `\n→ Espace à prévoir sur l'appareil : segments (${formatBytes(compressedTotal)}) + base décompressée (${
    rawSize ? formatBytes(rawSize) : "?"
  }) ≈ ${formatBytes(compressedTotal + rawSize)}.`
);
if (rawSize >= 2 ** 32) {
  console.error("⚠️  La base dépasse 4 Go : la taille lue dans le trailer GZIP est erronée (modulo 2^32). Utilisez --raw-size.");
}
