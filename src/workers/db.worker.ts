// Worker SQLite — Nomad Pocket Library (Étape 2)
//
// Rôle : exécuter les requêtes SQL DIRECTEMENT sur le fichier `oeuvres.db`
// résidant dans l'OPFS, sans jamais le charger intégralement en mémoire.
//
// Répartition réelle des responsabilités (aucune supposition) :
//  - Thread principal : sélecteur de fichiers (<input type="file">), UI, OPFS en
//    écriture via createWritable (pipeline d'installation), IndexedDB (données
//    personnelles), speechSynthesis / SpeechRecognition.
//  - Worker (ce fichier) : OPFS en LECTURE via FileSystemSyncAccessHandle
//    (API exclusivement disponible en contexte Worker) + moteur wa-sqlite.
//
// Protocole : postMessage bidirectionnel, avec `requestId` pour les appels
// request/response, et messages push pour le scan progressif du catalogue.

import { Factory as buildSqliteApi } from "wa-sqlite";
// @ts-ignore -- le paquet déclare son module ESM avec `export =`, ce que
// TypeScript refuse en import par défaut sans `esModuleInterop`. Le module
// réel expose bien un export par défaut (voir README de wa-sqlite) : l'import
// ci-dessous est correct à l'exécution, seul le typage est en cause.
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import * as VFS from "wa-sqlite/src/VFS.js";
import { ReadOnlySingleFileVFS, type SyncByteReader } from "../lib/vfs/ReadOnlyFileVFS";

type FactoryFn = (config?: { wasmBinary?: ArrayBuffer; locateFile?: (file: string) => string }) => Promise<unknown>;

function resolveModuleFactory(): FactoryFn {
  const candidate = SQLiteESMFactory as unknown;
  if (typeof candidate === "function") return candidate as FactoryFn;
  const withDefault = candidate as { default?: FactoryFn };
  if (withDefault && typeof withDefault.default === "function") return withDefault.default;
  throw new Error("Module wa-sqlite introuvable ou format inattendu.");
}

const DB_PATH = "oeuvres.db";
const VFS_NAME = "nomad-ro";

// Types minimaux : on ne dépend pas de la présence de FileSystemSyncAccessHandle
// dans lib.dom.d.ts (selon la version de TypeScript).
interface SyncAccessHandleLike {
  read(buffer: Uint8Array, options?: { at?: number }): number;
  getSize(): number;
  close(): Promise<void>;
}

type WorkerRequest =
  | { type: "open"; requestId: string; wasmBinary?: ArrayBuffer }
  | { type: "get-oeuvre"; requestId: string; id: string }
  | { type: "get-meta"; requestId: string; ids: string[] }
  | { type: "scan-catalog"; requestId: string }
  | { type: "stats"; requestId: string }
  | { type: "close"; requestId: string };

let sqlite3: SQLiteAPI | null = null;
let db: number | null = null;
let vfs: ReadOnlySingleFileVFS | null = null;
let opening = false;

/** Ouvre le fichier OPFS en accès synchronisé (contexte Worker uniquement). */
async function openOpfsReader(path: string): Promise<SyncByteReader> {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(path).catch(() => null);
  if (!fileHandle) {
    throw new Error(`« ${path} » est introuvable dans le stockage OPFS de ce navigateur.`);
  }

  const anyHandle = fileHandle as unknown as {
    createSyncAccessHandle?: () => Promise<SyncAccessHandleLike>;
  };

  if (typeof anyHandle.createSyncAccessHandle === "function") {
    const handle = await anyHandle.createSyncAccessHandle();
    return {
      read(view, at) {
        return handle.read(view, { at });
      },
      size() {
        return handle.getSize();
      },
      async close() {
        await handle.close();
      },
    };
  }

  // Repli : certains WebView n'exposent pas createSyncAccessHandle. FileReaderSync
  // (disponible en Worker) permet des lectures synchrones par tranches de Blob,
  // sans verrou exclusif et sans charger le fichier en mémoire.
  const file = await fileHandle.getFile();
  interface FileReaderSyncLike {
    readAsArrayBuffer(blob: Blob): ArrayBuffer;
  }
  const FileReaderSyncCtor = (
    globalThis as unknown as { FileReaderSync?: new () => FileReaderSyncLike }
  ).FileReaderSync;
  if (!FileReaderSyncCtor) {
    throw new Error(
      "Ni createSyncAccessHandle ni FileReaderSync ne sont disponibles : ce navigateur ne peut pas lire la base en flux."
    );
  }
  const reader = new FileReaderSyncCtor();
  return {
    read(view, at) {
      if (at >= file.size) return 0;
      const blob = file.slice(at, at + view.byteLength);
      const buffer = reader.readAsArrayBuffer(blob);
      const bytes = new Uint8Array(buffer);
      view.set(bytes.subarray(0, view.byteLength));
      return Math.min(bytes.byteLength, view.byteLength);
    },
    size() {
      return file.size;
    },
    async close() {
      /* rien à libérer */
    },
  };
}

/**
 * Charge le binaire WASM de SQLite. Par défaut, on laisse le module Emscripten
 * résoudre lui-même son binaire : le bundler l'a remplacé par une URL de
 * données embarquée, ce qui évite de dupliquer 744 Ko de base64 dans le bundle
 * principal et fonctionne hors-ligne sans aucune requête réseau.
 * Les replis ne servent qu'aux contextes de développement.
 */
async function instantiateSqliteModule(
  factory: FactoryFn,
  wasmBinary?: ArrayBuffer
): Promise<unknown> {
  if (wasmBinary) {
    try {
      return await factory({ wasmBinary });
    } catch {
      /* on tente les autres stratégies */
    }
  }
  try {
    return await factory();
  } catch (primaryError) {
    const prefixes = ["/node_modules/wa-sqlite/dist/", "/sqlite/"];
    let lastError = primaryError;
    for (const prefix of prefixes) {
      try {
        return await factory({ locateFile: (file: string) => `${prefix}${file}` });
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      `Binaire SQLite WASM introuvable (${String(lastError)}). Rechargez l'application en ligne une fois.`
    );
  }
}

async function handleOpen(request: Extract<WorkerRequest, { type: "open" }>): Promise<void> {
  if (db !== null) return; // déjà ouvert
  if (opening) throw new Error("Ouverture déjà en cours.");
  opening = true;
  try {
    const factory = resolveModuleFactory();
    const module = await instantiateSqliteModule(factory, request.wasmBinary);
    sqlite3 = buildSqliteApi(module) as SQLiteAPI;

    const reader = await openOpfsReader(DB_PATH);
    const files = new Map<string, SyncByteReader>([[DB_PATH, reader]]);
    vfs = new ReadOnlySingleFileVFS(VFS_NAME, files);
    sqlite3.vfs_register(vfs, false);

    db = await sqlite3.open_v2(DB_PATH, VFS.SQLITE_OPEN_READONLY, VFS_NAME);

    // Bornage mémoire + interdiction stricte d'écriture.
    await sqlite3.exec(db, "PRAGMA temp_store = MEMORY");
    await sqlite3.exec(db, "PRAGMA mmap_size = 0");
    await sqlite3.exec(db, "PRAGMA cache_size = -4096"); // ~4 Mo de cache de pages
    await sqlite3.exec(db, "PRAGMA query_only = 1");

    // Vérification rapide (ne lit que la première page) : si l'en-tête n'est pas
    // un fichier SQLite valide, on échoue immédiatement avec un message clair.
    const header = await sqlite3.execWithParams(
      db,
      "SELECT count(*) FROM pragma_database_list WHERE name = 'main'"
    );
    if (!header.rows.length) throw new Error("Base illisible.");
  } finally {
    opening = false;
  }
}

/** Colonnes situées AVANT `texte_integral` dans le schéma : leur lecture
 *  n'entraîne AUCUN accès aux pages de débordement, donc reste quasi instantanée
 *  même sur une base de 1,64 Go. Les colonnes situées après (nb_mots, siecle…)
 *  imposerient de parcourir tout le texte : on ne les demande jamais en masse. */
const META_COLUMNS =
  "id, titre, auteur, dates_auteur, type_genre, categories_tags, tome, sources_disponibles";

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToMeta(row: unknown[]): CatalogMetaRow {
  return {
    id: String(row[0] ?? ""),
    titre: String(row[1] ?? ""),
    auteur: String(row[2] ?? ""),
    dates_auteur: String(row[3] ?? ""),
    type_genre: String(row[4] ?? ""),
    categories_tags: parseJsonArray(row[5]),
    tome: String(row[6] ?? ""),
    sources_disponibles: parseJsonArray(row[7]),
  };
}

export interface CatalogMetaRow {
  id: string;
  titre: string;
  auteur: string;
  dates_auteur: string;
  type_genre: string;
  categories_tags: string[];
  tome: string;
  sources_disponibles: string[];
}

function requireDb(): number {
  if (db === null || sqlite3 === null) throw new Error("La base n'est pas ouverte.");
  return db;
}

async function handleGetOeuvre(id: string) {
  const handle = requireDb();
  const { rows } = await sqlite3!.execWithParams(
    handle,
    `SELECT id, titre, auteur, dates_auteur, type_genre, categories_tags, tome,
            sources_disponibles, texte_integral, nb_mots, nb_caracteres,
            temps_lecture_min, siecle, mouvement_litteraire
     FROM oeuvres WHERE id = ?`,
    [id]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r[0] ?? ""),
    titre: String(r[1] ?? ""),
    auteur: String(r[2] ?? ""),
    dates_auteur: String(r[3] ?? ""),
    type_genre: String(r[4] ?? ""),
    categories_tags: parseJsonArray(r[5]),
    tome: String(r[6] ?? ""),
    sources_disponibles: parseJsonArray(r[7]),
    texte_integral: String(r[8] ?? ""),
    nb_mots: Number(r[9] ?? 0),
    nb_caracteres: Number(r[10] ?? 0),
    temps_lecture_min: Number(r[11] ?? 0),
    siecle: String(r[12] ?? ""),
    mouvement_litteraire: String(r[13] ?? ""),
  };
}

async function handleGetMeta(ids: string[]) {
  const handle = requireDb();
  const result: CatalogMetaRow[] = [];
  // Requêtes unitaires par clé primaire : 1 requête = 1 lookup d'index, jamais
  // de scan complet. On reste sur des petits lots (marque-pages, historique).
  for (const id of ids.slice(0, 200)) {
    const { rows } = await sqlite3!.execWithParams(
      handle,
      `SELECT ${META_COLUMNS} FROM oeuvres WHERE id = ?`,
      [id]
    );
    if (rows.length) result.push(rowToMeta(rows[0]));
  }
  return result;
}

async function handleScanCatalog(requestId: string) {
  const handle = requireDb();
  const batch: CatalogMetaRow[] = [];
  let scanned = 0;
  await sqlite3!.exec(handle, `SELECT ${META_COLUMNS} FROM oeuvres`, (row: unknown[]) => {
    batch.push(rowToMeta(row));
    scanned += 1;
  });
  self.postMessage({ type: "catalog-batch", requestId, rows: batch, scanned, done: true });
}

async function handleStats() {
  const handle = requireDb();
  const info = await sqlite3!.execWithParams(handle, "PRAGMA page_size");
  const pageSize = Number(info.rows[0]?.[0] ?? 0);
  const count = await sqlite3!.execWithParams(handle, "SELECT max(rowid) FROM oeuvres");
  const maxRowid = Number(count.rows[0]?.[0] ?? 0);
  const sample = await sqlite3!.execWithParams(
    handle,
    `SELECT ${META_COLUMNS} FROM oeuvres LIMIT 1`
  );
  const size = vfs?.mainFileSize() ?? 0;
  return {
    pageSize,
    maxRowid,
    dbBytes: size,
    hasRows: sample.rows.length > 0,
  };
}

async function handleClose() {
  if (db !== null && sqlite3 !== null) {
    try {
      await sqlite3.close(db);
    } catch {
      /* déjà fermé */
    }
    db = null;
  }
  vfs?.dispose();
  vfs = null;
  sqlite3 = null;
}

function reply(requestId: string, payload: Record<string, unknown>) {
  self.postMessage({ type: "result", requestId, ...payload });
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "open") {
    try {
      await handleOpen(msg);
      const stats = await handleStats().catch(() => null);
      reply(msg.requestId, { ok: true, stats });
    } catch (err) {
      await handleClose().catch(() => undefined);
      reply(msg.requestId, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "close") {
    try {
      await handleClose();
      reply(msg.requestId, { ok: true });
    } catch (err) {
      reply(msg.requestId, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  try {
    switch (msg.type) {
      case "get-oeuvre": {
        const oeuvre = await handleGetOeuvre(msg.id);
        reply(msg.requestId, { ok: true, oeuvre });
        break;
      }
      case "get-meta": {
        const meta = await handleGetMeta(msg.ids);
        reply(msg.requestId, { ok: true, meta });
        break;
      }
      case "scan-catalog": {
        await handleScanCatalog(msg.requestId);
        break;
      }
      case "stats": {
        const stats = await handleStats();
        reply(msg.requestId, { ok: true, stats });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    reply(msg.requestId, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
