/**
 * Test de bout en bout — Nomad Pocket Library (Étape 2)
 *
 * Chaîne validée d'un seul tenant, sur le corpus de démonstration réellement
 * livré dans dist/demo-corpus :
 *
 *   manifest.json → lecture ordonnée des segments → vérification SHA-256
 *   → décompression GZIP en flux → base SQLite reconstituée
 *   → ReadOnlySingleFileVFS (code de production)
 *   → wa-sqlite (même binaire WASM que celui livré au navigateur)
 *   → scan du catalogue + lecture d'une œuvre par clé primaire
 *
 * Ce test reprend volontairement la logique de src/lib/corpus.ts (runPipeline)
 * plutôt que de l'importer : l'objectif est de valider le protocole, indépendamment
 * des API navigateur (fetch, OPFS) indisponibles ici.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as pako from "pako";
import { createHash } from "node:crypto";
import { Factory } from "wa-sqlite";
// @ts-ignore -- typage `export =` (voir src/workers/db.worker.ts)
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import { ReadOnlySingleFileVFS, type SyncByteReader } from "../src/lib/vfs/ReadOnlyFileVFS";

const CORPUS_DIR = "public/demo-corpus";

function openNodeReader(filePath: string): SyncByteReader {
  const fd = fs.openSync(filePath, "r");
  const size = fs.statSync(filePath).size;
  return {
    read(view: Uint8Array, at: number): number {
      const scratch = Buffer.alloc(view.byteLength);
      const read = fs.readSync(fd, scratch, 0, view.byteLength, at);
      if (read > 0) view.set(scratch.subarray(0, read));
      return read;
    },
    size(): number {
      return size;
    },
    close(): void {
      fs.closeSync(fd);
    },
  };
}

interface ManifestChunk {
  name: string;
  bytes: number;
  sha256: string;
}

async function main() {
  console.log("→ 1. Lecture du manifeste");
  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "manifest.json"), "utf8")) as {
    nom_projet: string;
    version: string;
    taille_brute_octets: number;
    taille_compresse_octets: number;
    chunks: ManifestChunk[];
  };
  console.log(
    `   ${manifest.nom_projet} v${manifest.version} — ${manifest.chunks.length} segments, ` +
      `${manifest.taille_compresse_octets} octets compressés, ${manifest.taille_brute_octets} attendus décompressés`
  );

  console.log("→ 2. Segments : ordre, taille, empreinte SHA-256");
  const inflator = new pako.Inflate();
  const produced: Uint8Array[] = [];
  inflator.onData = (chunk: Uint8Array) => produced.push(chunk);

  for (let i = 0; i < manifest.chunks.length; i += 1) {
    const chunk = manifest.chunks[i];
    const bytes = new Uint8Array(fs.readFileSync(path.join(CORPUS_DIR, chunk.name)));

    if (bytes.length !== chunk.bytes) {
      throw new Error(`${chunk.name} : ${bytes.length} octets lus, ${chunk.bytes} annoncés`);
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== chunk.sha256) {
      throw new Error(`${chunk.name} : empreinte SHA-256 invalide (fichier corrompu ?)`);
    }
    inflator.push(bytes, i === manifest.chunks.length - 1);
    if (inflator.err) throw new Error(`Décompression échouée sur ${chunk.name} : ${inflator.msg}`);
  }
  if (!inflator.ended) throw new Error("Flux GZIP incomplet : dernier segment manquant ?");

  const total = produced.reduce((sum, block) => sum + block.length, 0);
  const database = Buffer.concat(produced.map((block) => Buffer.from(block)));
  console.log(`   ✓ ${manifest.chunks.length}/${manifest.chunks.length} segments vérifiés et décompressés`);
  console.log(`   ✓ Base reconstituée : ${total.toLocaleString("fr-FR")} octets (attendu ${manifest.taille_brute_octets})`);
  if (total !== manifest.taille_brute_octets) throw new Error("Taille décompressée incohérente avec le manifeste");
  if (database.subarray(0, 15).toString("latin1") !== "SQLite format 3") {
    throw new Error("La base reconstituée n'est pas un fichier SQLite valide");
  }

  const tmpFile = path.join(os.tmpdir(), "nomad-e2e-oeuvres.db");
  fs.writeFileSync(tmpFile, database);

  console.log("→ 3. Ouverture via wa-sqlite + VFS lecture seule (code de production)");
  const wasm = fs.readFileSync("node_modules/wa-sqlite/dist/wa-sqlite.wasm");
  const factory = SQLiteESMFactory as (config?: { wasmBinary?: ArrayBuffer }) => Promise<unknown>;
  const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer;
  const sqlite3 = Factory(await factory({ wasmBinary })) as ReturnType<typeof Factory>;

  const files = new Map<string, SyncByteReader>([["oeuvres.db", openNodeReader(tmpFile)]]);
  const vfs = new ReadOnlySingleFileVFS("nomad-ro", files);
  sqlite3.vfs_register(vfs, false);

  const handle = await sqlite3.open_v2("oeuvres.db", 1 /* SQLITE_OPEN_READONLY */, "nomad-ro");
  await sqlite3.exec(handle, "PRAGMA temp_store = MEMORY");
  await sqlite3.exec(handle, "PRAGMA cache_size = -4096");
  await sqlite3.exec(handle, "PRAGMA query_only = 1");
  console.log(`   ✓ Base ouverte en lecture seule (${vfs.mainFileSize().toLocaleString("fr-FR")} octets)`);

  console.log("→ 4. Scan du catalogue (colonnes situées avant texte_integral)");
  const t0 = Date.now();
  const catalog: { id: string; titre: string; auteur: string }[] = [];
  await sqlite3.exec(
    handle,
    "SELECT id, titre, auteur, dates_auteur, type_genre, categories_tags, tome, sources_disponibles FROM oeuvres",
    (row) => {
      catalog.push({ id: String(row[0]), titre: String(row[1]), auteur: String(row[2]) });
    }
  );
  console.log(`   ✓ ${catalog.length} œuvres en ${Date.now() - t0} ms`);
  if (catalog.length !== 10) throw new Error(`Catalogue incomplet : ${catalog.length} œuvres`);

  console.log("→ 5. Lecture d'œuvres complètes par clé primaire");
  for (const expected of catalog) {
    const t1 = Date.now();
    const result = await sqlite3.execWithParams(
      handle,
      "SELECT texte_integral, nb_mots, siecle, mouvement_litteraire FROM oeuvres WHERE id = ?",
      [expected.id]
    );
    const text = String(result.rows[0]?.[0] ?? "");
    if (text.length < 40) throw new Error(`${expected.id} : texte intégral vide ou tronqué`);
    console.log(
      `   ✓ ${expected.titre.slice(0, 34).padEnd(34)} ${String(text.length).padStart(6)} car. ` +
        `${String(Date.now() - t1).padStart(3)} ms`
    );
  }

  console.log("→ 6. Ordre des segments incorrect doit être détecté");
  // Un SHA-256 erroné (segment permuté) doit provoquer un échec explicite.
  const swapped = [...manifest.chunks];
  const first = swapped[0];
  swapped[0] = swapped[1];
  swapped[1] = first;
  const mismatch = swapped.some((chunk, index) => {
    const bytes = fs.readFileSync(path.join(CORPUS_DIR, chunk.name));
    return createHash("sha256").update(bytes).digest("hex") !== manifest.chunks[index].sha256;
  });
  if (!mismatch) throw new Error("La permutation de segments n'a pas été détectée !");
  console.log("   ✓ Une permutation de segments est bien repérée par les empreintes");

  await sqlite3.close(handle);
  vfs.dispose();
  fs.rmSync(tmpFile, { force: true });

  console.log("\n=== TEST DE BOUT EN BOUT : OK ✅ ===");
}

main().catch((err) => {
  console.error("=== ÉCHEC DU TEST ❌ ===");
  console.error(err);
  process.exit(1);
});
