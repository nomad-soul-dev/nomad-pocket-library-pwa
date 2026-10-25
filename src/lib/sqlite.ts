// Moteur SQLite in-browser — Nomad Pocket Library
//
// Choix retenu pour ce POC : sql.js (SQLite compilé en WebAssembly, binding JS mûr,
// aucune dépendance native, fonctionne aussi côté Node pour la génération du corpus
// de démonstration — cf. scripts/build-demo-corpus.mjs).
//
// Limite assumée et clairement documentée (voir ARCHITECTURE.md) :
// sql.js charge l'intégralité de la base en mémoire WASM (un seul ArrayBuffer).
// Pour le corpus de démonstration (quelques dizaines de Ko), c'est sans risque.
// Pour le corpus complet (~1,53 Gio), cette approche devient risquée sur mobile
// (allocation contiguë, pression mémoire, crash possible du onglet). La cible
// Étape 2 est une migration vers wa-sqlite + VFS OPFS (accès paginé au fichier,
// sans chargement intégral en RAM). Ce module est volontairement conçu avec une
// interface stable (openDatabase/queryAll/getById) pour permettre ce remplacement
// sans impacter le reste de l'application.

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { Oeuvre } from "../types";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file) => `/sqlite/${file}`,
    });
  }
  return sqlJsPromise;
}

let dbInstance: Database | null = null;

export async function openDatabase(bytes: Uint8Array): Promise<void> {
  const SQL = await getSqlJs();
  dbInstance?.close();
  dbInstance = new SQL.Database(bytes);
}

export function isDatabaseOpen(): boolean {
  return dbInstance !== null;
}

export function closeDatabase(): void {
  dbInstance?.close();
  dbInstance = null;
}

function rowToOeuvre(row: Record<string, unknown>): Oeuvre {
  return {
    id: String(row.id),
    titre: String(row.titre ?? ""),
    auteur: String(row.auteur ?? ""),
    dates_auteur: String(row.dates_auteur ?? ""),
    type_genre: String(row.type_genre ?? ""),
    categories_tags: safeJsonArray(row.categories_tags),
    tome: String(row.tome ?? ""),
    sources_disponibles: safeJsonArray(row.sources_disponibles),
    texte_integral: String(row.texte_integral ?? ""),
    nb_mots: Number(row.nb_mots ?? 0),
    nb_caracteres: Number(row.nb_caracteres ?? 0),
    temps_lecture_min: Number(row.temps_lecture_min ?? 0),
    siecle: String(row.siecle ?? ""),
    mouvement_litteraire: String(row.mouvement_litteraire ?? ""),
  };
}

function safeJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function getOeuvreById(id: string): Oeuvre | null {
  if (!dbInstance) return null;
  const stmt = dbInstance.prepare("SELECT * FROM oeuvres WHERE id = :id");
  stmt.bind({ ":id": id });
  let result: Oeuvre | null = null;
  if (stmt.step()) {
    result = rowToOeuvre(stmt.getAsObject());
  }
  stmt.free();
  return result;
}

export function listAllOeuvres(): Oeuvre[] {
  if (!dbInstance) return [];
  const stmt = dbInstance.prepare("SELECT * FROM oeuvres ORDER BY auteur, titre");
  const rows: Oeuvre[] = [];
  while (stmt.step()) {
    rows.push(rowToOeuvre(stmt.getAsObject()));
  }
  stmt.free();
  return rows;
}

export function countOeuvres(): number {
  if (!dbInstance) return 0;
  const stmt = dbInstance.prepare("SELECT COUNT(*) as n FROM oeuvres");
  stmt.step();
  const n = Number(stmt.getAsObject().n ?? 0);
  stmt.free();
  return n;
}
