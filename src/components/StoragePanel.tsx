import { useEffect, useRef, useState } from "react";
import {
  downloadAndInstallCorpus,
  getInstalledManifest,
  importLocalFilesAndInstall,
  normalizeManifest,
  uninstallCorpus,
} from "../lib/corpus";
import {
  estimateStorage,
  hasCorpusInstalled,
  isStoragePersisted,
  requestPersistentStorage,
  resolveBackend,
} from "../lib/storage";
import { dbClient } from "../lib/db-client";
import { cacheCatalog, formatBytes, readIndexFile } from "../lib/catalog";
import type { CorpusManifest, ImportProgress, StorageBackend } from "../types";

export function StoragePanel({
  baseUrl,
  onBaseUrlChange,
  onCorpusInstalled,
  onCorpusRemoved,
  onCatalogUpdated,
}: {
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  onCorpusInstalled: () => void;
  onCorpusRemoved: () => void;
  onCatalogUpdated: (count: number) => void;
}) {
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [manifest, setManifest] = useState<CorpusManifest | undefined>(undefined);
  const [installed, setInstalled] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const corpusInputRef = useRef<HTMLInputElement>(null);
  const indexInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setBackend(await resolveBackend());
    setEstimate(await estimateStorage());
    setPersisted(await isStoragePersisted());
    setManifest(await getInstalledManifest());
    setInstalled(await hasCorpusInstalled());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const handleDownload = () =>
    guard(async () => {
      await downloadAndInstallCorpus(baseUrl.replace(/\/$/, ""), setProgress);
      setProgress((current) => current ?? null);
      onCorpusInstalled();
    });

  const handleLocalImport = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    void guard(async () => {
      const manifestFile = list.find((f) => /manifest\.json$/i.test(f.name));
      if (!manifestFile) {
        throw new Error(
          "Sélectionnez également le fichier manifest.json (avec les segments corpus_part_*.bin)."
        );
      }
      const parsed = normalizeManifest(JSON.parse(await manifestFile.text()));
      const chunks = list.filter((f) => f !== manifestFile && /\.bin$/i.test(f.name));
      if (chunks.length === 0) {
        throw new Error("Aucun fichier corpus_part_*.bin détecté dans la sélection.");
      }
      const indexFile = list.find((f) => /catalog_index\.json$/i.test(f.name));
      if (indexFile) {
        const entries = await readIndexFile(indexFile);
        await cacheCatalog(entries, "index-fichier");
        onCatalogUpdated(entries.length);
        setInfo(`Index du catalogue importé (${entries.length} œuvres).`);
      }
      await importLocalFilesAndInstall(parsed, chunks, setProgress);
      onCorpusInstalled();
    });
    if (corpusInputRef.current) corpusInputRef.current.value = "";
  };

  const handleIndexImport = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    void guard(async () => {
      const entries = await readIndexFile(files[0]);
      if (entries.length === 0) throw new Error("Ce fichier ne contient aucune œuvre.");
      await cacheCatalog(entries, "index-fichier");
      onCatalogUpdated(entries.length);
      setInfo(`Catalogue chargé : ${entries.length.toLocaleString("fr-FR")} œuvres.`);
    });
    if (indexInputRef.current) indexInputRef.current.value = "";
  };

  const handleScan = () =>
    guard(async () => {
      if (!dbClient.isOpen) {
        throw new Error("La base n'est pas ouverte : installez d'abord le corpus.");
      }
      const rows = await dbClient.scanCatalog();
      if (rows.length === 0) throw new Error("Aucune œuvre trouvée dans la base installée.");
      const entries = rows.map((row) => ({
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
        txt: 1 as const,
        src: row.sources_disponibles,
      }));
      await cacheCatalog(entries, "base-sqlite");
      onCatalogUpdated(entries.length);
      setInfo(
        `Catalogue reconstruit depuis la base : ${entries.length.toLocaleString("fr-FR")} œuvres (métadonnées partielles, sans lecture du texte).`
      );
    });

  const quotaPct = estimate && estimate.quota > 0 ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold">Stockage de l'appareil</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt style={{ color: "var(--text-dim)" }}>Moteur</dt>
            <dd className="font-medium">
              {backend === "opfs" ? "OPFS (fichier privé)" : backend === "indexeddb" ? "IndexedDB (repli)" : "Indisponible"}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--text-dim)" }}>Accès SQLite</dt>
            <dd className="font-medium">{dbClient.isOpen ? "Worker · lecture paginée" : "Base fermée"}</dd>
          </div>
          <div className="col-span-2">
            <dt style={{ color: "var(--text-dim)" }}>
              Espace utilisé par l'origine — quota estimé par le navigateur
            </dt>
            <dd className="mt-1">
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-elevated-2)" }}>
                <div className="h-full rounded-full" style={{ width: `${quotaPct}%`, background: "var(--accent)" }} />
              </div>
              <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
                {estimate ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}` : "Estimation indisponible"}
              </span>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
          {persisted
            ? "Stockage persistant accordé : Android ne devrait pas libérer cet espace sans votre accord."
            : "Stockage non persistant : le système peut libérer cet espace sous pression. Appuyez ci-dessous pour le demander."}
        </p>
        {persisted === false && (
          <button
            onClick={() => void requestPersistentStorage().then(setPersisted)}
            className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            Demander un stockage persistant
          </button>
        )}
      </section>

      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold">Corpus littéraire</h2>
        {installed && manifest ? (
          <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-dim)" }}>
            <p className="font-medium" style={{ color: "var(--text)" }}>
              {manifest.nom_projet} — v{manifest.version}
            </p>
            <p>
              {manifest.nombre_chunks} segments · {formatBytes(manifest.taille_compresse_octets)} compressé →{" "}
              {formatBytes(manifest.taille_brute_octets)} décompressé
            </p>
            <p>Compression : {manifest.algo_compression}</p>
          </div>
        ) : (
          <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
            Aucun corpus installé sur cet appareil.
          </p>
        )}

        <label className="mt-4 block text-xs" style={{ color: "var(--text-dim)" }}>
          URL du corpus (GitHub Pages, serveur local…)
          <input
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]"
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
            placeholder="https://mon-compte.github.io/nomad-corpus"
          />
        </label>

        <div className="mt-3 flex flex-col gap-2">
          <button
            disabled={busy}
            onClick={handleDownload}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            ⬇️ Télécharger et installer depuis cette URL
          </button>
          <button
            disabled={busy}
            onClick={() => corpusInputRef.current?.click()}
            className="rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            📂 Importer depuis l'appareil (manifest + .bin)
          </button>
          <input
            ref={corpusInputRef}
            type="file"
            multiple
            accept=".bin,.json"
            className="hidden"
            onChange={(e) => handleLocalImport(e.target.files)}
          />
          <button
            disabled={busy}
            onClick={() => indexInputRef.current?.click()}
            className="rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            🗂️ Importer le catalogue (catalog_index.json)
          </button>
          <input
            ref={indexInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => handleIndexImport(e.target.files)}
          />
          <button
            disabled={busy || !installed}
            onClick={handleScan}
            className="rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            ♻️ Reconstruire le catalogue depuis la base
          </button>
          {installed && (
            <button
              disabled={busy}
              onClick={() =>
                guard(async () => {
                  await uninstallCorpus();
                  onCorpusRemoved();
                  setInfo("Corpus supprimé, espace libéré.");
                })
              }
              className="text-xs font-medium underline disabled:opacity-50"
              style={{ color: "var(--text-dim)" }}
            >
              Supprimer le corpus installé
            </button>
          )}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
          Import local : sélectionnez en une fois <code>manifest.json</code>, les segments{" "}
          <code>corpus_part_*.bin</code> et, si vous l'avez, <code>catalog_index.json</code>. Aucune
          connexion n'est nécessaire. L'ordre des segments est rétabli d'après le manifeste, et chaque
          empreinte SHA-256 présente est vérifiée avant décompression.
        </p>
      </section>

      {(info || error) && (
        <div
          className="rounded-2xl border p-3 text-xs"
          style={{
            borderColor: error ? "#dc2626" : "var(--border)",
            background: error ? "rgba(220,38,38,0.08)" : "var(--bg-elevated)",
          }}
        >
          {error ?? info}
        </div>
      )}

      {(progress || busy) && (
        <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
          <h2 className="text-sm font-semibold">Installation</h2>
          {progress && (
            <>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-elevated-2)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress.totalChunks ? (progress.chunkIndex / progress.totalChunks) * 100 : 4}%`,
                    background: progress.stage === "error" ? "#dc2626" : "var(--accent)",
                  }}
                />
              </div>
              <p className="mt-2 text-xs font-medium">
                {progress.stage} — segment {progress.chunkIndex}/{progress.totalChunks}
                {progress.bytesTotal > 0 && ` · ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`}
              </p>
              <p className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
                {progress.message}
              </p>
            </>
          )}
          <div
            className="mt-3 max-h-48 overflow-y-auto rounded-lg p-2 font-mono text-[10px] scrollbar-thin"
            style={{ background: "var(--bg-elevated-2)", color: "var(--text-dim)" }}
          >
            {(progress?.log ?? ["en attente…"]).map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
