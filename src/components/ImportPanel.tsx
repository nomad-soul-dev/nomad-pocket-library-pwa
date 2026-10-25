import { useEffect, useRef, useState } from "react";
import {
  downloadAndInstallCorpus,
  getInstalledManifest,
  importLocalFilesAndInstall,
} from "../lib/corpus";
import {
  deleteCorpus,
  estimateStorage,
  hasCorpusInstalled,
  requestPersistentStorage,
  resolveBackend,
} from "../lib/storage";
import { closeDatabase } from "../lib/sqlite";
import type { CorpusManifest, ImportProgress, StorageBackend } from "../types";

const DEMO_BASE_URL = "/demo-corpus";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

export function ImportPanel({ onInstalled, onRemoved }: { onInstalled: () => void; onRemoved: () => void }) {
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [manifest, setManifest] = useState<CorpusManifest | undefined>(undefined);
  const [installed, setInstalled] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refreshStatus() {
    setBackend(await resolveBackend());
    setEstimate(await estimateStorage());
    setManifest(await getInstalledManifest());
    setInstalled(await hasCorpusInstalled());
    if (navigator.storage?.persisted) {
      setPersisted(await navigator.storage.persisted());
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function handleDownloadDemo() {
    setBusy(true);
    setErrorMsg(null);
    try {
      await downloadAndInstallCorpus(DEMO_BASE_URL, setProgress);
      await refreshStatus();
      onInstalled();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLocalImport(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const files = Array.from(fileList);
      const manifestFile = files.find((f) => f.name.endsWith("manifest.json"));
      if (!manifestFile) {
        throw new Error(
          "Aucun fichier manifest.json sélectionné. Choisissez-le en même temps que les segments corpus_part_*.bin."
        );
      }
      const manifestData: CorpusManifest = JSON.parse(await manifestFile.text());
      const segmentFiles = files.filter((f) => f !== manifestFile);
      await importLocalFilesAndInstall(manifestData, segmentFiles, setProgress);
      await refreshStatus();
      onInstalled();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete() {
    closeDatabase();
    await deleteCorpus();
    await refreshStatus();
    setProgress(null);
    onRemoved();
  }

  async function handlePersist() {
    const ok = await requestPersistentStorage();
    setPersisted(ok);
  }

  const quotaPct = estimate && estimate.quota > 0 ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          État du stockage
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt style={{ color: "var(--text-dim)" }}>Moteur de persistance</dt>
            <dd className="font-medium" style={{ color: "var(--text)" }}>
              {backend === "opfs" ? "OPFS (fichier privé)" : backend === "indexeddb" ? "IndexedDB (repli)" : "Indisponible"}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--text-dim)" }}>Stockage persistant</dt>
            <dd className="font-medium" style={{ color: "var(--text)" }}>
              {persisted === null ? "Non vérifiable" : persisted ? "Oui" : "Non (effaçable sous pression mémoire)"}
            </dd>
          </div>
          <div className="col-span-2">
            <dt style={{ color: "var(--text-dim)" }}>Espace navigateur utilisé / quota</dt>
            <dd className="mt-1">
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-elevated-2)" }}>
                <div className="h-full rounded-full" style={{ width: `${quotaPct}%`, background: "var(--accent)" }} />
              </div>
              <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
                {estimate ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}` : "Estimation indisponible sur ce navigateur"}
              </span>
            </dd>
          </div>
        </dl>
        {persisted === false && (
          <button
            onClick={handlePersist}
            className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            Demander un stockage persistant
          </button>
        )}
      </section>

      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Corpus littéraire
        </h2>
        {installed && manifest ? (
          <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-dim)" }}>
            <p>
              <strong style={{ color: "var(--text)" }}>{manifest.nom_projet}</strong> — v{manifest.version}
            </p>
            <p>
              {manifest.nombre_chunks} segments · {formatBytes(manifest.taille_compresse_octets)} compressé →{" "}
              {formatBytes(manifest.taille_brute_octets)} décompressé
            </p>
            <p className="italic">{manifest.note}</p>
          </div>
        ) : (
          <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
            Aucun corpus installé. Choisissez une méthode d'installation ci-dessous. Ce POC utilise un corpus de
            démonstration (10 œuvres du domaine public) afin de valider le pipeline complet avant mise à l'échelle sur
            les 5098 œuvres réelles.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            disabled={busy}
            onClick={handleDownloadDemo}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            ⬇️ Télécharger le corpus de démonstration
          </button>
          <button
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            📂 Importer depuis l'appareil
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".bin,.json"
            className="hidden"
            onChange={(e) => handleLocalImport(e.target.files)}
          />
        </div>
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
          Import local : sélectionnez à la fois <code>manifest.json</code> et les fichiers <code>corpus_part_*.bin</code>{" "}
          préalablement téléchargés (ex. depuis Google Drive) et copiés sur l'appareil. Aucun réseau requis.
        </p>

        {installed && (
          <button
            onClick={handleDelete}
            className="mt-3 text-xs font-medium underline"
            style={{ color: "var(--text-dim)" }}
          >
            Supprimer le corpus installé et libérer l'espace
          </button>
        )}
      </section>

      {(progress || errorMsg) && (
        <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Progression de l'import
          </h2>
          {progress && (
            <>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-elevated-2)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress.totalChunks ? (progress.chunkIndex / progress.totalChunks) * 100 : 0}%`,
                    background: progress.stage === "error" ? "#dc2626" : "var(--accent)",
                  }}
                />
              </div>
              <p className="mt-2 text-xs font-medium" style={{ color: "var(--text)" }}>
                Étape : {progress.stage} — segment {progress.chunkIndex}/{progress.totalChunks}
              </p>
            </>
          )}
          {errorMsg && <p className="mt-2 text-xs font-medium text-red-500">{errorMsg}</p>}
          <div
            className="mt-3 max-h-40 overflow-y-auto rounded-lg p-2 font-mono text-[10px] scrollbar-thin"
            style={{ background: "var(--bg-elevated-2)", color: "var(--text-dim)" }}
          >
            {progress?.log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </section>
      )}
    </div>
  );
}
