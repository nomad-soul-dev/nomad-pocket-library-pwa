// Persistance — Nomad Pocket Library
//
// Répartition des données (distinction exigée par le cahier des charges) :
//  1. Cache de l'interface PWA  → Service Worker (CacheStorage, voir public/sw.js)
//  2. Corpus littéraire (1,64 Go) → OPFS, un seul fichier `oeuvres.db`, écrit en
//     flux lors de l'installation puis OUVERT EN LECTURE SEULE par le Worker.
//     On ne le recharge jamais intégralement en mémoire (cf. lib/vfs/).
//  3. Données personnelles (marque-pages, progression, œuvres écrites, notes,
//     réglages) → IndexedDB, exportables/importables en JSON.

import type { StorageBackend } from "../types";

const OPFS_CORPUS_FILENAME = "oeuvres.db";
const IDB_NAME = "nomad-pocket-library";
const IDB_VERSION = 2;
const STORE_CORPUS = "corpus";
const STORE_KV = "kv";
const STORE_WORKS = "works";
const STORE_BOOKMARKS = "bookmarks";
const STORE_NOTES = "notes";

export function detectOPFS(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof (navigator.storage as unknown as { getDirectory?: unknown }).getDirectory === "function"
  );
}

let cachedBackend: StorageBackend | null = null;

export async function resolveBackend(): Promise<StorageBackend> {
  if (cachedBackend) return cachedBackend;
  if (detectOPFS()) {
    try {
      const root = await navigator.storage.getDirectory();
      // Certains navigateurs exposent l'API sans l'implémenter : on sonde.
      const probe = await root.getFileHandle("__nomad_probe__", { create: true });
      const writable = await probe.createWritable();
      await writable.write(new Uint8Array([1]) as unknown as BufferSource);
      await writable.close();
      await root.removeEntry("__nomad_probe__");
      cachedBackend = "opfs";
      return cachedBackend;
    } catch {
      cachedBackend = "indexeddb";
      return cachedBackend;
    }
  }
  cachedBackend = typeof indexedDB !== "undefined" ? "indexeddb" : "none";
  return cachedBackend;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of [STORE_CORPUS, STORE_KV, STORE_WORKS, STORE_BOOKMARKS, STORE_NOTES]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  if (!idbAvailable()) return;
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  if (!idbAvailable()) return undefined;
  const db = await openIdb();
  const result = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function idbDelete(store: string, key: string): Promise<void> {
  if (!idbAvailable()) return;
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbKeys(store: string): Promise<string[]> {
  if (!idbAvailable()) return [];
  const db = await openIdb();
  const result = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function idbValues<T>(store: string): Promise<T[]> {
  if (!idbAvailable()) return [];
  const db = await openIdb();
  const result = await new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

/* ------------------------------------------------------------------ */
/* Corpus : écriture en flux + interrogation sans chargement complet   */
/* ------------------------------------------------------------------ */

export interface StreamWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/**
 * Ouvre un flux d'écriture vers le fichier corpus. Aucun octet n'est conservé
 * en mémoire côté OPFS : chaque bloc décompressé est écrit au fil de l'eau.
 */
export async function openCorpusWriter(): Promise<StreamWriter> {
  const backend = await resolveBackend();

  if (backend === "opfs") {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_CORPUS_FILENAME, { create: true });
    const writable = await handle.createWritable();
    let currentOffset = 0;
    return {
      async write(chunk) {
        await writable.write({ type: "write", position: currentOffset, data: chunk as unknown as BufferSource } as any);
        currentOffset += chunk.length;
      },
      async close() {
        await writable.close();
      },
      async abort() {
        await writable.abort().catch(() => undefined);
      },
    };
  }

  // Repli IndexedDB : bufferisation (acceptable pour le corpus de démonstration,
  // explicitement déconseillée pour 1,64 Go — voir ARCHITECTURE.md).
  const parts: Uint8Array[] = [];
  let total = 0;
  return {
    async write(chunk) {
      parts.push(chunk);
      total += chunk.length;
    },
    async close() {
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
      }
      await idbPut(STORE_CORPUS, OPFS_CORPUS_FILENAME, merged);
      parts.length = 0;
    },
    async abort() {
      parts.length = 0;
      total = 0;
    },
  };
}

/**
 * Interroge le corpus SANS le lire : seule la taille du fichier est consultée.
 * C'est le contrôle d'intégrité après installation (taille attendue du manifeste).
 */
export async function statCorpus(): Promise<{ bytes: number } | null> {
  const backend = await resolveBackend();
  if (backend === "opfs") {
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(OPFS_CORPUS_FILENAME);
      const file = await handle.getFile();
      return { bytes: file.size };
    } catch {
      return null;
    }
  }
  if (backend === "indexeddb") {
    const bytes = await idbGet<Uint8Array>(STORE_CORPUS, OPFS_CORPUS_FILENAME);
    return bytes && bytes.length > 0 ? { bytes: bytes.length } : null;
  }
  return null;
}

export async function deleteCorpus(): Promise<void> {
  const backend = await resolveBackend();
  if (backend === "opfs") {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(OPFS_CORPUS_FILENAME);
    } catch {
      /* déjà absent */
    }
  } else if (backend === "indexeddb") {
    await idbDelete(STORE_CORPUS, OPFS_CORPUS_FILENAME);
  }
}

export async function hasCorpusInstalled(): Promise<boolean> {
  return (await statCorpus()) !== null;
}

/* ------------------------------------------------------------------ */
/* Clé/valeur : réglages, progression de lecture, métadonnées         */
/* ------------------------------------------------------------------ */

export async function kvSet<T>(key: string, value: T): Promise<void> {
  if (idbAvailable()) {
    await idbPut(STORE_KV, key, value);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota dépassé : non bloquant */
  }
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  if (idbAvailable()) return idbGet<T>(STORE_KV, key);
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : undefined;
}

export async function kvDelete(key: string): Promise<void> {
  if (idbAvailable()) {
    await idbDelete(STORE_KV, key);
    return;
  }
  localStorage.removeItem(key);
}

/** Liste des clés personnelles (progression de lecture) pour la sauvegarde JSON. */
export async function kvKeys(): Promise<string[]> {
  if (!idbAvailable()) return Object.keys(localStorage);
  return idbKeys(STORE_KV);
}

export const KV_STORE_NAME = STORE_KV;

/* ------------------------------------------------------------------ */
/* Œuvres personnelles (éditeur)                                       */
/* ------------------------------------------------------------------ */

export interface PersonalWork {
  id: string;
  titre: string;
  auteur: string;
  type_genre: string;
  texte: string;
  createdAt: number;
  updatedAt: number;
}

export async function listWorks(): Promise<PersonalWork[]> {
  const works = await idbValues<PersonalWork>(STORE_WORKS);
  return works.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveWork(work: PersonalWork): Promise<void> {
  await idbPut(STORE_WORKS, work.id, work);
}

export async function deleteWork(id: string): Promise<void> {
  await idbDelete(STORE_WORKS, id);
}

/* ------------------------------------------------------------------ */
/* Marque-pages manuels et notes vocales                              */
/* ------------------------------------------------------------------ */

export interface BookmarkRecord {
  id: string;
  oeuvreId: string;
  oeuvreTitre: string;
  auteur: string;
  paragraphIndex: number;
  excerpt: string;
  note?: string;
  createdAt: number;
}

export interface NoteRecord {
  id: string;
  text: string;
  createdAt: number;
  source: "dictée" | "saisie";
}

export async function listBookmarks(): Promise<BookmarkRecord[]> {
  const rows = await idbValues<BookmarkRecord>(STORE_BOOKMARKS);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveBookmark(record: BookmarkRecord): Promise<void> {
  await idbPut(STORE_BOOKMARKS, record.id, record);
}

export async function deleteBookmark(id: string): Promise<void> {
  await idbDelete(STORE_BOOKMARKS, id);
}

export async function listNotes(): Promise<NoteRecord[]> {
  const rows = await idbValues<NoteRecord>(STORE_NOTES);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveNote(note: NoteRecord): Promise<void> {
  await idbPut(STORE_NOTES, note.id, note);
}

export async function deleteNote(id: string): Promise<void> {
  await idbDelete(STORE_NOTES, id);
}

export async function listNoteIds(): Promise<string[]> {
  return idbKeys(STORE_NOTES);
}

/* ------------------------------------------------------------------ */
/* Quotas et persistance                                              */
/* ------------------------------------------------------------------ */

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  }
  return null;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) return navigator.storage.persist();
  return false;
}

export async function isStoragePersisted(): Promise<boolean | null> {
  if (navigator.storage && navigator.storage.persisted) return navigator.storage.persisted();
  return null;
}
