// Pipeline corpus — Nomad Pocket Library (Étape 2)
//
// Chaîne validée sur appareil réel (Galaxy S21 Ultra) : import local des 20
// segments → vérification SHA-256 → décompression GZIP en flux → écriture OPFS
// (1,64 Go en 13 s).
//
// Corrigé dans cette étape :
//  1. `manifest.chunks` accepte les DEUX formes réellement produites par le
//     backend : tableau d'objets `{name, bytes, sha256}` OU tableau de chaînes
//     `["corpus_part_01.bin", …]`.
//  2. SHA-256 facultatif : si un segment n'a pas d'empreinte dans le manifeste,
//     la vérification est sautée proprement (plus de `undefined.slice()`).
//  3. Découverte automatique de l'agencement GZIP : soit un flux unique
//     découpé en N segments, soit N flux GZIP indépendants. La détection
//     intervient dès le premier segment pour ne rien gaspiller.
//  4. Fin d'installation SANS relecture de la base : on compare la taille du
//     fichier OPFS à `taille_brute_octets`. L'ouverture est déléguée au Worker,
//     qui lit le fichier par pages (aucune allocation contiguë de 1,64 Go).

import * as pako from "pako";
import type { CorpusManifest, ImportProgress, ImportStage, ManifestChunk } from "../types";
import { sha256Hex } from "./crypto";
import { dbClient } from "./db-client";
import {
  deleteCorpus,
  kvGet,
  kvSet,
  openCorpusWriter,
  statCorpus,
} from "./storage";

export type ProgressCallback = (progress: ImportProgress) => void;

const MANIFEST_KEY = "corpus:installed-manifest";
const DEMO_FALLBACK_CHUNKS = 4;

/** Normalise un manifeste, quel que soit le format réellement rencontré. */
export function normalizeManifest(raw: unknown): CorpusManifest {
  if (!raw || typeof raw !== "object") throw new Error("Manifeste illisible.");
  const source = raw as Record<string, unknown>;

  const rawChunks = Array.isArray(source.chunks) ? source.chunks : [];
  const chunks: ManifestChunk[] = rawChunks.map((entry, index) => {
    if (typeof entry === "string") {
      return { name: entry, bytes: 0, sha256: "" };
    }
    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      return {
        name: String(obj.name ?? obj.nom ?? obj.fichier ?? `corpus_part_${index + 1}.bin`),
        bytes: Number(obj.bytes ?? obj.taille ?? obj.size ?? 0),
        sha256: String(obj.sha256 ?? obj.hash ?? ""),
      };
    }
    return { name: `corpus_part_${index + 1}.bin`, bytes: 0, sha256: "" };
  });

  if (chunks.length === 0) {
    const declared = Number(source.nombre_chunks ?? 0);
    const count = Number.isFinite(declared) && declared > 0 ? declared : DEMO_FALLBACK_CHUNKS;
    for (let i = 0; i < count; i += 1) {
      chunks.push({ name: `corpus_part_${String(i + 1).padStart(2, "0")}.bin`, bytes: 0, sha256: "" });
    }
  }

  const knownBytes = chunks.reduce((sum, c) => sum + (c.bytes || 0), 0);
  const declaredCompressed = Number(source.taille_compresse_octets ?? 0);
  const declaredRaw = Number(source.taille_brute_octets ?? 0);

  return {
    nom_projet: String(source.nom_projet ?? "Corpus Nomad Pocket Library"),
    version: String(source.version ?? "inconnue"),
    algo_compression: String(source.algo_compression ?? source.compression ?? "gzip"),
    taille_brute_octets: declaredRaw,
    taille_compresse_octets: declaredCompressed || knownBytes,
    nombre_chunks: chunks.length,
    chunks,
    generated_at: String(source.generated_at ?? ""),
    note: String(source.note ?? ""),
  };
}

class ChunkBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChunkBoundaryError";
  }
}

function makeTracker(onProgress: ProgressCallback | undefined) {
  const log: string[] = [];
  const state: ImportProgress = {
    stage: "idle",
    chunkIndex: 0,
    totalChunks: 0,
    bytesDone: 0,
    bytesTotal: 0,
    message: "",
    log,
  };
  return {
    state,
    emit(stage: ImportStage, chunkIndex: number, message: string) {
      state.stage = stage;
      state.chunkIndex = chunkIndex;
      state.message = message;
      log.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      if (log.length > 400) log.splice(0, log.length - 400);
      onProgress?.({ ...state, log: [...log] });
    },
  };
}

export async function fetchManifest(baseUrl: string): Promise<CorpusManifest> {
  const response = await fetch(`${baseUrl}/manifest.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Manifeste introuvable (${response.status}).`);
  return normalizeManifest(await response.json());
}

type ChunkSource = (chunkName: string) => Promise<Uint8Array>;

async function fetchChunkWithRetry(baseUrl: string, name: string): Promise<Uint8Array> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/${name}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Téléchargement impossible pour ${name} : ${String(lastError)}`);
}

/**
 * Cœur du pipeline. `layout` détermine la stratégie de décompression :
 *  - "single"    : un seul flux GZIP découpé en N segments (cas nominal)
 *  - "per-chunk" : N flux GZIP indépendants (un par segment)
 */
async function runPipeline(
  manifest: CorpusManifest,
  getChunk: ChunkSource,
  layout: "single" | "per-chunk",
  tracker: ReturnType<typeof makeTracker>
): Promise<void> {
  const writer = await openCorpusWriter();
  const inflator = new pako.Inflate();
  const produced: Uint8Array[] = [];
  let producedBytes = 0;
  inflator.onData = (chunk: Uint8Array) => {
    produced.push(chunk);
    producedBytes += chunk.length;
  };

  const flush = async () => {
    for (const block of produced) await writer.write(block);
    produced.length = 0;
  };

  try {
    for (let i = 0; i < manifest.chunks.length; i += 1) {
      const chunk = manifest.chunks[i];
      const isLast = i === manifest.chunks.length - 1;

      tracker.emit("downloading", i, `Segment ${i + 1}/${manifest.chunks.length} — ${chunk.name}`);
      const bytes = await getChunk(chunk.name);

      if (chunk.sha256) {
        tracker.emit("verifying", i + 1, `Vérification SHA-256 de ${chunk.name}…`);
        const hash = await sha256Hex(bytes);
        if (hash !== chunk.sha256) {
          throw new Error(
            `Empreinte SHA-256 invalide pour ${chunk.name} (attendu ${chunk.sha256.slice(
              0,
              12
            )}…, obtenu ${hash.slice(0, 12)}…). Le fichier est probablement incomplet ou corrompu.`
          );
        }
      } else {
        tracker.emit("verifying", i + 1, `Aucune empreinte SHA-256 fournie pour ${chunk.name} : contrôle sauté.`);
      }

      tracker.state.bytesDone += bytes.length;

      tracker.emit("decompressing", i + 1, `Décompression de ${chunk.name}…`);
      if (layout === "single") {
        inflator.push(bytes, isLast);
        if (inflator.err) {
          // Un échec avant le dernier segment signale un flux GZIP indépendant
          // par segment : on remonte une erreur identifiable pour relancer en
          // mode « per-chunk » sans avoir gaspillé tout le téléchargement.
          if (!isLast && i === 0) {
            throw new ChunkBoundaryError(
              `Flux GZIP non continu (${inflator.msg}) : tentative en mode segment autonome.`
            );
          }
          throw new Error(`Décompression échouée sur ${chunk.name} : ${inflator.msg}`);
        }
      } else {
        const local = new pako.Inflate();
        const blocks: Uint8Array[] = [];
        local.onData = (block: Uint8Array) => blocks.push(block);
        local.push(bytes, true);
        if (local.err) throw new Error(`Décompression échouée sur ${chunk.name} : ${local.msg}`);
        for (const block of blocks) await writer.write(block);
      }

      tracker.emit("writing-storage", i + 1, `Écriture en stockage persistant (${producedBytes} octets produits)…`);
      await flush();
    }

    if (layout === "single") {
      // Un flux GZIP doit se terminer proprement (trailer + taille).
      if (!inflator.ended) {
        throw new Error("Le flux compressé est incomplet : le dernier segment semble manquant.");
      }
    }

    await writer.close();
  } catch (err) {
    await writer.abort();
    // Un échec ne doit jamais laisser de base partielle en place.
    await deleteCorpus().catch(() => undefined);
    throw err;
  }
}

async function install(
  manifest: CorpusManifest,
  getChunk: ChunkSource,
  onProgress?: ProgressCallback
): Promise<void> {
  const tracker = makeTracker(onProgress);
  tracker.state.totalChunks = manifest.chunks.length;
  tracker.state.bytesTotal = manifest.taille_compresse_octets;

  // Le Worker ne doit pas conserver de verrou OPFS sur la base pendant l'écriture.
  await dbClient.close().catch(() => undefined);

  tracker.emit("fetching-manifest", 0, `Manifeste « ${manifest.nom_projet} » v${manifest.version} — ${manifest.chunks.length} segments.`);

  try {
    const mode = (manifest.chunks && manifest.chunks.length > 1) ? "per-chunk" : "single";
    await runPipeline(manifest, getChunk, mode, tracker);
  } catch (err) {
    if (err instanceof ChunkBoundaryError) {
      tracker.emit("fetching-manifest", 0, err.message);
      await runPipeline(manifest, getChunk, "per-chunk", tracker);
    } else {
      tracker.emit("error", 0, `Échec de l'installation : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // Contrôle final SANS relecture : la taille du fichier doit correspondre.
  tracker.emit("opening-db", manifest.chunks.length, "Contrôle de la base installée…");
  const stat = await statCorpus();
  if (!stat) throw new Error("Le corpus n'a pas été trouvé après écriture.");
  if (manifest.taille_brute_octets && stat.bytes !== manifest.taille_brute_octets) {
    await deleteCorpus().catch(() => undefined);
    throw new Error(
      `Taille de la base installée incohérente : ${stat.bytes} octets obtenus, ${manifest.taille_brute_octets} attendus. Installation annulée.`
    );
  }

  await kvSet(MANIFEST_KEY, manifest);
  tracker.emit("ready", manifest.chunks.length, `Base installée (${stat.bytes.toLocaleString("fr-FR")} octets). Ouverture en lecture paginée…`);
}

export async function downloadAndInstallCorpus(
  baseUrl: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const manifest = await fetchManifest(baseUrl);
  await install(manifest, (name) => fetchChunkWithRetry(baseUrl, name), onProgress);
}

/**
 * Import local : l'utilisateur sélectionne les fichiers depuis l'appareil via
 * `<input type="file" multiple>` (thread principal uniquement — le Service
 * Worker ne peut pas piloter un sélecteur de fichiers). Le manifeste peut être
 * l'un des fichiers choisis, ou une URL distante.
 */
export async function importLocalFilesAndInstall(
  manifest: CorpusManifest,
  files: File[],
  onProgress?: ProgressCallback
): Promise<void> {
  const byName = new Map(files.map((file) => [file.name, file]));
  await install(manifest, async (name) => {
    const file = byName.get(name);
    if (!file) throw new Error(`Segment manquant parmi les fichiers sélectionnés : ${name}`);
    return new Uint8Array(await file.arrayBuffer());
  }, onProgress);
}

export async function getInstalledManifest(): Promise<CorpusManifest | undefined> {
  const raw = await kvGet<CorpusManifest>(MANIFEST_KEY);
  return raw ? normalizeManifest(raw) : undefined;
}

/** Ouvre la base déjà installée, via le Worker (lecture paginée, hors-ligne). */
export async function reopenInstalledCorpus(): Promise<boolean> {
  const stat = await statCorpus();
  if (!stat || stat.bytes === 0) return false;
  try {
    await dbClient.open();
    return true;
  } catch {
    return false;
  }
}

export async function uninstallCorpus(): Promise<void> {
  await dbClient.close().catch(() => undefined);
  dbClient.hardReset();
  await deleteCorpus();
}
