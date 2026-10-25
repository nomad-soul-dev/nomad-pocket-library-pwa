// Catalogue — Nomad Pocket Library
//
// Le catalogue (5098 œuvres) n'est PAS extrait de la base SQLite en masse :
// les colonnes `nb_mots`, `temps_lecture_min`, `siecle`, `mouvement_litteraire`
// sont stockées APRÈS `texte_integral` dans le schéma, donc leur lecture impose
// de parcourir les pages de débordement (autrement dit les 1,64 Go de texte).
//
// On utilise donc, dans l'ordre :
//  1. `catalog_index.json` (≈2,5 Mo, métadonnées complètes) — fourni par le
//     backend, chargé depuis l'URL du corpus ou importé comme fichier local ;
//  2. à défaut, un scan SQLite limité aux colonnes placées avant le texte
//     (lecture quasi instantanée, métadonnées partielles) ;
//  3. le tout est mis en cache IndexedDB pour rester disponible hors-ligne.

import { dbClient, type CatalogMetaRow } from "./db-client";
import { getInstalledManifest } from "./corpus";
import { kvGet, kvSet } from "./storage";
import type { CatalogEntry } from "../types";

const CACHE_KEY = "catalog:entries";
const CACHE_SOURCE_KEY = "catalog:source";
const CACHE_SIGNATURE_KEY = "catalog:signature";
const DEFAULT_BASE_URL = "/demo-corpus";

/**
 * Empreinte du corpus installé. Le catalogue est mis en cache IndexedDB : sans
 * cette empreinte, remplacer le corpus de démonstration (10 œuvres) par le corpus
 * réel (5 098 œuvres) laisserait l'application afficher l'ancien cache.
 */
async function corpusSignature(): Promise<string> {
  const manifest = await getInstalledManifest().catch(() => undefined);
  if (!manifest) return "aucun-corpus-installe";
  return `${manifest.version}|${manifest.taille_brute_octets}|${manifest.nombre_chunks}`;
}

export interface CatalogLoadResult {
  entries: CatalogEntry[];
  source: "cache" | "index-fichier" | "base-sqlite" | "vide";
  scanned: boolean;
}

function entryFromIndex(raw: Record<string, unknown>): CatalogEntry {
  return {
    id: String(raw.id ?? raw.i ?? ""),
    t: String(raw.t ?? raw.titre ?? ""),
    a: String(raw.a ?? raw.auteur ?? ""),
    d: String(raw.d ?? raw.dates_auteur ?? ""),
    g: String(raw.g ?? raw.type_genre ?? ""),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    vol: String(raw.vol ?? raw.tome ?? ""),
    mots: Number(raw.mots ?? 0),
    min: Number(raw.min ?? raw.temps_lecture_min ?? 0),
    sec: String(raw.sec ?? raw.siecle ?? ""),
    mouv: String(raw.mouv ?? raw.mouvement_litteraire ?? ""),
    txt: 1,
    src: Array.isArray(raw.src) ? raw.src.map(String) : [],
  };
}

function entryFromDbRow(row: CatalogMetaRow): CatalogEntry {
  return {
    id: row.id,
    t: row.titre,
    a: row.auteur,
    d: row.dates_auteur,
    g: row.type_genre,
    tags: row.categories_tags,
    vol: row.tome,
    mots: 0,
    min: 0,
    sec: "",
    mouv: "",
    txt: 1,
    src: row.sources_disponibles,
  };
}

function parseIndexPayload(payload: unknown): CatalogEntry[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => entryFromIndex(item as Record<string, unknown>));
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["oeuvres", "entries", "catalog", "data"]) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as Record<string, unknown>[]).map(entryFromIndex);
      }
    }
  }
  throw new Error("Format d'index de catalogue non reconnu.");
}

export async function readIndexFile(file: File): Promise<CatalogEntry[]> {
  return parseIndexPayload(JSON.parse(await file.text()));
}

/** Cache valide uniquement s'il correspond au corpus actuellement installé. */
async function readValidCache(): Promise<CatalogEntry[] | null> {
  const [cached, signature] = await Promise.all([
    kvGet<CatalogEntry[]>(CACHE_KEY),
    kvGet<string>(CACHE_SIGNATURE_KEY),
  ]);
  if (!Array.isArray(cached) || cached.length === 0) return null;
  return signature === (await corpusSignature()) ? cached : null;
}

export async function cacheCatalog(entries: CatalogEntry[], source: string): Promise<void> {
  await kvSet(CACHE_KEY, entries);
  await kvSet(CACHE_SOURCE_KEY, source);
  await kvSet(CACHE_SIGNATURE_KEY, await corpusSignature());
}

export async function getCachedCatalogSource(): Promise<string | undefined> {
  return kvGet<string>(CACHE_SOURCE_KEY);
}

export async function clearCatalogCache(): Promise<void> {
  await kvSet(CACHE_KEY, []);
  await kvSet(CACHE_SOURCE_KEY, "");
  await kvSet(CACHE_SIGNATURE_KEY, "");
}

/**
 * Charge le catalogue. `baseUrl` désigne l'URL du corpus (GitHub Pages, local…).
 * `allowScan` autorise la reconstruction depuis la base SQLite si aucun index
 * n'est disponible.
 */
export async function loadCatalog(
  baseUrl: string | null = DEFAULT_BASE_URL,
  allowScan = true
): Promise<CatalogLoadResult> {
  const cached = await readValidCache();
  if (cached) return { entries: cached, source: "cache", scanned: true };

  // Cache périmé (corpus remplacé) : purge immédiate, afin de ne jamais afficher
  // les métadonnées d'une autre base que celle réellement installée.
  const stored = await kvGet<CatalogEntry[]>(CACHE_KEY);
  if (Array.isArray(stored) && stored.length > 0) {
    await clearCatalogCache().catch(() => undefined);
  }

  if (baseUrl) {
    try {
      const response = await fetch(`${baseUrl}/catalog_index.json`, { cache: "no-store" });
      if (response.ok) {
        const entries = parseIndexPayload(await response.json());
        if (entries.length > 0) {
          await cacheCatalog(entries, `index:${baseUrl}`);
          return { entries, source: "index-fichier", scanned: true };
        }
      }
    } catch {
      /* hors-ligne ou fichier absent : on tente les autres sources */
    }
  }

  if (allowScan && dbClient.isOpen) {
    try {
      const rows = await dbClient.scanCatalog();
      const entries = rows.map(entryFromDbRow);
      if (entries.length > 0) {
        await cacheCatalog(entries, "base-sqlite");
        return { entries, source: "base-sqlite", scanned: true };
      }
    } catch {
      /* base absente ou illisible */
    }
  }

  return { entries: [], source: "vide", scanned: false };
}

/** Fusionne les métadonnées manquantes d'un scan SQL avec un index complet. */
export function mergeCatalogs(primary: CatalogEntry[], extra: CatalogEntry[]): CatalogEntry[] {
  if (extra.length === 0) return primary;
  const byId = new Map(extra.map((entry) => [entry.id, entry]));
  return primary.map((entry) => {
    const enriched = byId.get(entry.id);
    if (!enriched) return entry;
    return {
      ...entry,
      mots: entry.mots || enriched.mots,
      min: entry.min || enriched.min,
      sec: entry.sec || enriched.sec,
      mouv: entry.mouv || enriched.mouv,
      tags: entry.tags.length > 0 ? entry.tags : enriched.tags,
    };
  });
}

export type SortKey = "auteur" | "titre" | "longueur" | "recent";

export interface CatalogFilters {
  query: string;
  genre: string | null;
  siecle: string | null;
  mouvement: string | null;
  sort: SortKey;
}

export function uniqueValues(entries: CatalogEntry[], key: "g" | "sec" | "mouv"): string[] {
  const set = new Set<string>();
  for (const entry of entries) {
    const value = entry[key];
    if (value && value !== "—") set.add(value);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

export function filterCatalog(entries: CatalogEntry[], filters: CatalogFilters): CatalogEntry[] {
  const query = filters.query.trim().toLowerCase();
  const terms = query ? query.split(/\s+/).filter(Boolean) : [];

  const filtered = entries.filter((entry) => {
    if (filters.genre && entry.g !== filters.genre) return false;
    if (filters.siecle && entry.sec !== filters.siecle) return false;
    if (filters.mouvement && entry.mouv !== filters.mouvement) return false;
    if (terms.length === 0) return true;
    const haystack = `${entry.t} ${entry.a} ${entry.g} ${entry.vol} ${entry.mouv}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  const sorted = [...filtered];
  switch (filters.sort) {
    case "titre":
      sorted.sort((a, b) => a.t.localeCompare(b.t, "fr"));
      break;
    case "longueur":
      sorted.sort((a, b) => b.mots - a.mots);
      break;
    case "recent":
      break;
    case "auteur":
    default:
      sorted.sort((a, b) => `${a.a} ${a.t}`.localeCompare(`${b.a} ${b.t}`, "fr"));
      break;
  }
  return sorted;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 o";
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}
