// Client SQLite côté thread principal — Nomad Pocket Library (Étape 2)
//
// Proxy typé vers le Worker `db.worker.ts`. Toutes les requêtes SQL réelles
// s'exécutent dans le Worker, sur le fichier OPFS, via wa-sqlite + VFS lecture
// seule. Le thread principal ne manipule jamais les octets de la base.

import DbWorker from "../workers/db.worker?worker&inline";
import type { Oeuvre } from "../types";

export interface DbStats {
  pageSize: number;
  maxRowid: number;
  dbBytes: number;
  hasRows: boolean;
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

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

type CatalogBatchHandler = (rows: CatalogMetaRow[], scanned: number, done: boolean) => void;

class DbClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private catalogHandlers = new Map<string, CatalogBatchHandler>();
  private openPromise: Promise<DbStats> | null = null;
  private requestSeq = 0;
  private opened = false;

  get isOpen(): boolean {
    return this.opened;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new DbWorker();
    worker.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
    worker.onerror = () => {
      this.failAll(new Error("Le Worker de base de données a rencontré une erreur fatale."));
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;
    const requestId = typeof msg.requestId === "string" ? msg.requestId : null;

    if (msg.type === "catalog-batch" && requestId) {
      const handler = this.catalogHandlers.get(requestId);
      if (handler) {
        handler(
          (msg.rows as CatalogMetaRow[]) ?? [],
          Number(msg.scanned ?? 0),
          Boolean(msg.done)
        );
      }
      return;
    }

    if (msg.type !== "result" || !requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if (msg.ok) pending.resolve(msg);
    else pending.reject(new Error(String(msg.error ?? "Erreur inconnue du Worker SQLite.")));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.opened = false;
  }

  private request<T>(payload: Record<string, unknown>): Promise<T> {
    const worker = this.ensureWorker();
    const requestId = `req-${++this.requestSeq}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      worker.postMessage({ ...payload, requestId });
    });
  }

  /** Ouvre la base (idempotent). Requiert que le corpus soit déjà installé. */
  async open(): Promise<DbStats> {
    if (this.opened) {
      const stats = await this.request<Record<string, unknown>>({ type: "stats" });
      return stats.stats as DbStats;
    }
    if (this.openPromise) return this.openPromise;

    this.openPromise = (async () => {
      const worker = this.ensureWorker();
      const requestId = `open-${++this.requestSeq}`;
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        this.pending.set(requestId, { resolve: (v) => resolve(v as Record<string, unknown>), reject });
        worker.postMessage({ type: "open", requestId });
      });
      this.opened = true;
      return result.stats as DbStats;
    })();

    try {
      return await this.openPromise;
    } catch (err) {
      // Le Worker est peut-être dans un état incohérent : on le détruit pour que
      // la prochaine tentative reparte d'un contexte propre.
      this.hardReset();
      throw err;
    } finally {
      this.openPromise = null;
    }
  }

  /** Récupère une œuvre complète (texte intégral) par identifiant. */
  async getOeuvre(id: string): Promise<Oeuvre | null> {
    const response = await this.request<{ oeuvre: Oeuvre | null }>({ type: "get-oeuvre", id });
    return response.oeuvre ?? null;
  }

  /** Métadonnées seules (sans texte) : lecture quasi instantanée. */
  async getMeta(ids: string[]): Promise<CatalogMetaRow[]> {
    const response = await this.request<{ meta: CatalogMetaRow[] }>({ type: "get-meta", ids });
    return response.meta ?? [];
  }

  /**
   * Reconstruit le catalogue depuis la base. Ne lit que les colonnes placées
   * AVANT `texte_integral` dans le schéma : aucun parcours des pages de
   * débordement, donc aucun accès aux 1,64 Go de texte.
   */
  async scanCatalog(onBatch?: CatalogBatchHandler): Promise<CatalogMetaRow[]> {
    const requestId = `scan-${++this.requestSeq}`;
    const rows: CatalogMetaRow[] = [];
    const worker = this.ensureWorker();

    const done = new Promise<CatalogMetaRow[]>((resolve, reject) => {
      this.catalogHandlers.set(requestId, (batch, _scanned, isDone) => {
        rows.push(...batch);
        onBatch?.(batch, rows.length, isDone);
        if (isDone) resolve(rows);
      });
      this.pending.set(requestId, {
        resolve: () => resolve(rows),
        reject,
      });
      worker.postMessage({ type: "scan-catalog", requestId });
    });

    try {
      return await done;
    } finally {
      this.catalogHandlers.delete(requestId);
      this.pending.delete(requestId);
    }
  }

  async stats(): Promise<DbStats> {
    const response = await this.request<{ stats: DbStats }>({ type: "stats" });
    return response.stats;
  }

  /** Fermeture propre : libère le verrou OPFS du SyncAccessHandle. */
  async close(): Promise<void> {
    if (!this.worker) return;
    try {
      await this.request({ type: "close" });
    } catch {
      this.hardReset();
      return;
    }
    this.opened = false;
  }

  /** Dernier recours : destruction du Worker (libère aussi le verrou OPFS). */
  hardReset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.opened = false;
    this.openPromise = null;
    this.failAll(new Error("Connexion à la base réinitialisée."));
  }
}

export const dbClient = new DbClient();
