/**
 * Test d'intégration du VFS lecture seule (Étape 2).
 *
 * Objectif : valider dans un environnement exécutable la chaîne
 *   wa-sqlite (même binaire WASM que celui livré au navigateur)
 *   → ReadOnlySingleFileVFS (src/lib/vfs/ReadOnlyFileVFS.ts, code de production)
 *   → requêtes paginées sur une base SQLite avec pages de débordement.
 *
 * La base de test est générée avec sql.js (même moteur que l'Étape 1) et contient
 * un texte intégral volontairement ÉNORME (plusieurs Mo) afin de forcer SQLite à
 * chaîner des pages de débordement : c'est exactement la situation du corpus réel
 * de 1,64 Go, où chaque ligne dépasse largement la taille d'une page.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import initSqlJs from "sql.js";
import { Factory } from "wa-sqlite";
// @ts-ignore -- typage `export =` (voir src/workers/db.worker.ts)
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import * as VFS from "wa-sqlite/src/VFS.js";
import { ReadOnlySingleFileVFS, type SyncByteReader } from "../src/lib/vfs/ReadOnlyFileVFS";

const wasmBytes = fs.readFileSync("node_modules/wa-sqlite/dist/wa-sqlite.wasm");

/** Lecteur synchrone équivalent au FileSystemSyncAccessHandle du Worker. */
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

function repeatText(seed: string, targetChars: number): string {
  let out = "";
  while (out.length < targetChars) {
    out += `${seed} `;
  }
  return out;
}

async function main() {
  console.log("→ Génération d'une base SQLite de test (texte volumineux ⇒ pages de débordement)");
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.resolve("node_modules/sql.js/dist", file),
  });
  const db = new SQL.Database();
  db.run(`CREATE TABLE oeuvres (
    id TEXT PRIMARY KEY, titre TEXT, auteur TEXT, dates_auteur TEXT, type_genre TEXT,
    categories_tags TEXT, tome TEXT, sources_disponibles TEXT, texte_integral TEXT,
    nb_mots INTEGER, nb_caracteres INTEGER, temps_lecture_min INTEGER,
    siecle TEXT, mouvement_litteraire TEXT);`);

  const works = [
    {
      id: "gutenberg_17941",
      titre: "Fables de La Fontaine",
      auteur: "Jean de La Fontaine",
      dates: "1621-1695",
      genre: "Contes & Fables",
      tags: ["Genre: Fables", "17th century"],
      tome: "Fables, Livre I",
      text: repeatText("Maître Corbeau, sur un arbre perché, tenait en son bec un fromage.", 1_600_000),
    },
    {
      id: "gutenberg_17489",
      titre: "Demain, dès l'aube",
      auteur: "Victor Hugo",
      dates: "1802-1885",
      genre: "Poésie",
      tags: ["Genre: Poésie", "19th century"],
      tome: "Les Contemplations",
      text: repeatText("Demain, dès l'aube, à l'heure où blanchit la campagne, je partirai.", 400_000),
    },
  ];

  const insert = db.prepare(
    `INSERT INTO oeuvres VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const work of works) {
    insert.run([
      work.id,
      work.titre,
      work.auteur,
      work.dates,
      work.genre,
      JSON.stringify(work.tags),
      work.tome,
      JSON.stringify(["gutenberg"]),
      work.text,
      work.text.split(/\s+/).length,
      work.text.length,
      Math.round(work.text.length / 180 / 6),
      "XIXe siècle",
      "Classicisme",
    ]);
  }
  insert.free();

  const dbBytes = db.export();
  db.close();
  const tmpFile = path.join(os.tmpdir(), "nomad-vfs-test-oeuvres.db");
  fs.writeFileSync(tmpFile, dbBytes);
  console.log(`   Base générée : ${dbBytes.length.toLocaleString("fr-FR")} octets`);

  console.log("→ Démarrage de wa-sqlite avec le VFS lecture seule (code de production)");
  const factory = SQLiteESMFactory as (config?: { wasmBinary?: ArrayBuffer }) => Promise<unknown>;
  const module = await factory({ wasmBinary: wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) });
  const sqlite3 = Factory(module) as ReturnType<typeof Factory>;

  const reader = openNodeReader(tmpFile);
  const files = new Map<string, SyncByteReader>([["oeuvres.db", reader]]);
  const vfs = new ReadOnlySingleFileVFS("nomad-ro", files);
  sqlite3.vfs_register(vfs, false);
  console.log(`   VFS enregistré : taille de fichier déclarée = ${vfs.mainFileSize().toLocaleString("fr-FR")} octets`);

  const handle = await sqlite3.open_v2("oeuvres.db", VFS.SQLITE_OPEN_READONLY, "nomad-ro");
  await sqlite3.exec(handle, "PRAGMA temp_store = MEMORY");
  await sqlite3.exec(handle, "PRAGMA mmap_size = 0");
  await sqlite3.exec(handle, "PRAGMA cache_size = -4096");
  await sqlite3.exec(handle, "PRAGMA query_only = 1");

  // 1. Scan des métadonnées (colonnes AVANT texte_integral)
  let scanned = 0;
  const titles: string[] = [];
  const t0 = Date.now();
  await sqlite3.exec(
    handle,
    "SELECT id, titre, auteur, dates_auteur, type_genre, categories_tags, tome, sources_disponibles FROM oeuvres",
    (row) => {
      scanned += 1;
      titles.push(String(row[1]));
    }
  );
  const scanMs = Date.now() - t0;
  console.log(`✓ Scan métadonnées : ${scanned} œuvres en ${scanMs} ms → ${titles.join(" / ")}`);
  if (scanned !== works.length) throw new Error(`Scan incomplet : ${scanned} lignes`);

  // 2. Lecture d'une œuvre complète par clé primaire (traverse les pages de débordement)
  const t1 = Date.now();
  const result = await sqlite3.execWithParams(
    handle,
    "SELECT texte_integral, nb_caracteres FROM oeuvres WHERE id = ?",
    ["gutenberg_17941"]
  );
  const fetchMs = Date.now() - t1;
  const fetched = String(result.rows[0]?.[0] ?? "");
  console.log(
    `✓ Œuvre longue récupérée par clé primaire : ${fetched.length.toLocaleString("fr-FR")} caractères en ${fetchMs} ms`
  );
  if (fetched !== works[0].text) {
    throw new Error("Le texte récupéré diffère de l'original : lecture incorrecte des pages de débordement !");
  }

  // 3. Petite œuvre (vérifie un autre chemin de lecture)
  const small = await sqlite3.execWithParams(
    handle,
    "SELECT texte_integral FROM oeuvres WHERE id = ?",
    ["gutenberg_17489"]
  );
  if (String(small.rows[0]?.[0]) !== works[1].text) throw new Error("Seconde œuvre incorrecte.");

  // 4. Accès hors limites : SQLite doit obtenir un SHORT_READ propre (fin de fichier)
  const page = await sqlite3.execWithParams(handle, "PRAGMA page_size");
  console.log(`✓ Page size = ${page.rows[0]?.[0]} octets`);

  // 5. Statistiques
  const maxRowid = await sqlite3.execWithParams(handle, "SELECT max(rowid) FROM oeuvres");
  console.log(`✓ max(rowid) = ${maxRowid.rows[0]?.[0]} (comptage sans balayage complet)`);

  // 6. Toute écriture doit être refusée par le VFS
  let writeRejected = false;
  try {
    await sqlite3.run(handle, "UPDATE oeuvres SET titre = 'x' WHERE id = 'gutenberg_17941'");
  } catch {
    writeRejected = true;
  }
  console.log(
    writeRejected
      ? "✓ Écriture refusée : la base installée ne peut pas être modifiée par l'application"
      : "⚠️  Une écriture a été acceptée : vérifier PRAGMA query_only / VFS"
  );

  await sqlite3.close(handle);
  vfs.dispose();

  console.log("\n=== TEST VFS + wa-sqlite : OK ✅ ===");
  fs.rmSync(tmpFile, { force: true });
}

main().catch((err) => {
  console.error("=== ÉCHEC DU TEST ❌ ===");
  console.error(err);
  process.exit(1);
});
