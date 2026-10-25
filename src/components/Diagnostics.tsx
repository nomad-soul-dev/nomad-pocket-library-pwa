import { useEffect, useState } from "react";
import { dbClient } from "../lib/db-client";
import { estimateStorage, isStoragePersisted, listBookmarks, listWorks, resolveBackend } from "../lib/storage";
import { getCachedCatalogSource } from "../lib/catalog";
import { getInstalledManifest } from "../lib/corpus";
import { formatBytes } from "../lib/catalog";
import { hasFrenchVoice, loadVoices } from "../lib/tts";

type Status = "ok" | "partial" | "todo" | "real";

interface RowDef {
  label: string;
  status: Status;
  detail: string;
}

const STATUS_LABEL: Record<Status, string> = {
  real: "📱 Validé sur S21 Ultra",
  ok: "✅ Validé ici",
  partial: "🟡 Partiel",
  todo: "⬜ À valider sur mobile",
};

const PIPELINE_ROWS: RowDef[] = [
  {
    label: "Import local 20 segments GZIP → vérification → décompression → OPFS",
    status: "real",
    detail: "Rapport Fabrice : 1,64 Go écrits en 13 s sur l'appareil.",
  },
  {
    label: "Repli XZ/LZMA preset 9 extrême",
    status: "todo",
    detail:
      "Abandonné : LZMA_MEMLIMIT_ERROR (liblzma code 8) — le dictionnaire XZ extreme dépasse la mémoire WASM mobile. GZIP niveau 6 retenu (607 Mo au lieu de 393 Mo).",
  },
  {
    label: "Ouverture wa-sqlite + VFS OPFS lecture seule (Worker)",
    status: "ok",
    detail: "Remplace sql.js : plus aucune allocation contiguë de 1,64 Go.",
  },
  {
    label: "Lecture d'une œuvre par clé primaire (texte paginé)",
    status: "ok",
    detail: "SELECT … WHERE id = ? : coût proportionnel à la taille de l'œuvre, pas de la base.",
  },
  {
    label: "TTS : lecture, pause, reprise au niveau de la phrase",
    status: "ok",
    detail: "Repli documenté si onboundary n'est pas émis par le moteur vocal.",
  },
  {
    label: "Persistance OPFS après redémarrage complet du navigateur",
    status: "todo",
    detail: "À confirmer sur l'appareil (fichier déjà installé, mode avion).",
  },
  {
    label: "Installation PWA sur l'écran d'accueil + Service Worker",
    status: "todo",
    detail: "À confirmer sur l'appareil.",
  },
  {
    label: "Dictée vocale (SpeechRecognition) hors-ligne",
    status: "partial",
    detail: "Dépend des packs de reconnaissance vocale installés sur l'appareil.",
  },
];

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2 text-xs last:border-0" style={{ borderColor: "var(--border)" }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span className="shrink-0 text-right font-medium">
        {ok !== undefined && <span className={ok ? "text-emerald-500" : "text-amber-500"}>● </span>}
        {value}
      </span>
    </div>
  );
}

export function Diagnostics() {
  const [backend, setBackend] = useState<string>("…");
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [dbState, setDbState] = useState<string>("fermée");
  const [dbBytes, setDbBytes] = useState<number>(0);
  const [catalogSource, setCatalogSource] = useState<string>("—");
  const [counts, setCounts] = useState({ bookmarks: 0, works: 0 });
  const [manifest, setManifest] = useState<string>("—");
  const [online, setOnline] = useState(navigator.onLine);
  const [swState, setSwState] = useState<string>("—");

  useEffect(() => {
    void resolveBackend().then((value) => setBackend(value));
    void estimateStorage().then(setEstimate);
    void isStoragePersisted().then(setPersisted);
    void loadVoices().then(setVoices);
    void getCachedCatalogSource().then((value) => setCatalogSource(value ?? "aucun"));
    void listBookmarks().then((rows) => setCounts((prev) => ({ ...prev, bookmarks: rows.length })));
    void listWorks().then((rows) => setCounts((prev) => ({ ...prev, works: rows.length })));
    void getInstalledManifest().then((value) =>
      setManifest(value ? `v${value.version} · ${value.nombre_chunks} segments` : "non installé")
    );
    if (dbClient.isOpen) {
      void dbClient
        .stats()
        .then((stats) => {
          setDbState(`ouverte · ${stats.hasRows ? "œuvres présentes" : "vide"}`);
          setDbBytes(stats.dbBytes);
        })
        .catch(() => setDbState("erreur d'accès"));
    }

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => setSwState(registration ? "enregistré" : "non enregistré"));
    }

    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const sttAvailable =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold">Environnement</h2>
        <div className="mt-2">
          <Row label="Réseau" value={online ? "en ligne" : "hors-ligne"} ok={true} />
          <Row label="Stockage corpus" value={backend} ok={backend === "opfs"} />
          <Row label="Persistance accordée" value={persisted === null ? "inconnue" : persisted ? "oui" : "non"} ok={persisted === true} />
          <Row
            label="Espace utilisé / quota"
            value={estimate ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}` : "indisponible"}
          />
          <Row label="Base SQLite" value={dbState} ok={dbClient.isOpen} />
          <Row label="Taille du fichier corpus" value={dbBytes > 0 ? formatBytes(dbBytes) : "—"} />
          <Row label="Source du catalogue" value={catalogSource} />
          <Row label="Manifeste installé" value={manifest} />
          <Row label="Voix détectées" value={`${voices.length} (dont ${voices.filter((v) => v.lang.startsWith("fr")).length} FR)`} ok={hasFrenchVoice(voices)} />
          <Row label="Dictée vocale" value={sttAvailable ? "API présente" : "non supportée"} ok={sttAvailable} />
          <Row label="Service Worker" value={swState} />
          <Row label="Données personnelles" value={`${counts.bookmarks} marque-pages · ${counts.works} écrits`} />
        </div>
      </section>

      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold">État de validation</h2>
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
          Distinction exigée par le cahier des charges entre ce qui a été vérifié dans cet
          environnement, ce qui a été validé sur ton Galaxy S21 Ultra, et ce qui reste à tester.
        </p>
        <ul className="mt-3 space-y-2.5 text-xs">
          {PIPELINE_ROWS.map((row) => (
            <li key={row.label} className="border-b pb-2 last:border-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-3">
                <span>{row.label}</span>
                <span className="shrink-0 whitespace-nowrap text-[10px]" style={{ color: "var(--text-dim)" }}>
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
              {row.detail && (
                <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-dim)" }}>
                  {row.detail}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
