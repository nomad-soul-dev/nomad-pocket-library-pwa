import { useCallback, useEffect, useState } from "react";
import { AppShell, type View } from "./components/AppShell";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { Bookmarks } from "./components/Bookmarks";
import { Works } from "./components/Works";
import { StoragePanel } from "./components/StoragePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { useReaderSettings } from "./hooks/useReaderSettings";
import { loadCatalog } from "./lib/catalog";
import { reopenInstalledCorpus } from "./lib/corpus";
import { dbClient } from "./lib/db-client";
import { kvGet, kvSet } from "./lib/storage";
import { speechController } from "./lib/tts";
import type { CatalogEntry, Oeuvre, ReadingPosition } from "./types";

const DEFAULT_BASE_URL = "/demo-corpus";

export default function App() {
  const { settings, update, reset } = useReaderSettings();
  const [view, setView] = useState<View>("library");
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [corpusReady, setCorpusReady] = useState(false);
  const [oeuvre, setOeuvre] = useState<Oeuvre | null>(null);
  const [resumeParagraph, setResumeParagraph] = useState<number | null>(null);
  const [lastRead, setLastRead] = useState<ReadingPosition | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_BASE_URL);
  const [notice, setNotice] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  /* --- Démarrage hors-ligne : corpus déjà installé ? --- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedUrl = await kvGet<string>("corpus:baseUrl");
      if (savedUrl) setBaseUrl(savedUrl);
      const ok = await reopenInstalledCorpus();
      if (cancelled) return;
      setCorpusReady(ok);
      const lastId = await kvGet<string>("progress:last");
      if (lastId) {
        const position = await kvGet<ReadingPosition>(`progress:${lastId}`);
        if (position) setLastRead(position);
      }
      setBooting(false);
    })().catch(() => setBooting(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCatalog = useCallback(
    async (allowScan: boolean) => {
      const result = await loadCatalog(baseUrl, allowScan).catch(() => null);
      if (!result) return;
      setCatalog(result.entries);
      return result;
    },
    [baseUrl]
  );

  useEffect(() => {
    if (!corpusReady) return;
    void refreshCatalog(false);
  }, [corpusReady, refreshCatalog]);

  const handleBaseUrlChange = useCallback((url: string) => {
    setBaseUrl(url);
    void kvSet("corpus:baseUrl", url);
  }, []);

  const openOeuvre = useCallback(
    async (id: string, paragraphIndex?: number) => {
      if (!corpusReady) {
        setNotice("Installez d'abord le corpus (onglet Stockage) pour accéder au texte intégral.");
        setView("storage");
        return;
      }
      try {
        const loaded = await dbClient.getOeuvre(id);
        if (!loaded || !loaded.texte_integral) {
          setNotice("Cette œuvre est référencée mais absente de la base installée.");
          return;
        }
        setNotice(null);
        setResumeParagraph(paragraphIndex ?? null);
        setOeuvre(loaded);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [corpusReady]
  );

  const handleCorpusInstalled = useCallback(() => {
    setCorpusReady(true);
    void refreshCatalog(true);
    setNotice(null);
  }, [refreshCatalog]);

  const handleCorpusRemoved = useCallback(() => {
    setCorpusReady(false);
    setCatalog([]);
    setLastRead(null);
    setNotice("Corpus supprimé. L'espace de stockage a été libéré.");
  }, []);

  if (oeuvre) {
    return (
      <Reader
        key={oeuvre.id}
        oeuvre={oeuvre}
        initialParagraph={resumeParagraph}
        settings={settings}
        onUpdateSetting={update}
        onBack={() => {
          speechController.stop();
          setOeuvre(null);
          setResumeParagraph(null);
          void kvGet<ReadingPosition>(`progress:${oeuvre.id}`).then((position) => {
            if (position) setLastRead(position);
          });
        }}
      />
    );
  }

  return (
    <AppShell view={view} onChange={setView} corpusReady={corpusReady} catalogCount={catalog.length}>
      {notice && (
        <div
          className="mb-4 rounded-xl border px-3 py-2 text-xs"
          style={{ borderColor: "var(--border)", background: "var(--accent-soft)" }}
        >
          {notice}
          <button onClick={() => setNotice(null)} className="ml-2 underline">
            fermer
          </button>
        </div>
      )}

      {booting && (
        <p className="py-8 text-center text-xs" style={{ color: "var(--text-dim)" }}>
          Ouverture de la bibliothèque…
        </p>
      )}

      {!booting && view === "library" && (
        <Library
          catalog={catalog}
          corpusReady={corpusReady}
          lastRead={lastRead}
          onOpen={(id) => void openOeuvre(id)}
          onGoToStorage={() => setView("storage")}
        />
      )}

      {view === "bookmarks" && (
        <Bookmarks
          onOpen={(oeuvreId, paragraphIndex) => void openOeuvre(oeuvreId, paragraphIndex)}
        />
      )}

      {view === "works" && <Works onRead={(item) => setOeuvre(item)} />}

      {view === "storage" && (
        <StoragePanel
          baseUrl={baseUrl}
          onBaseUrlChange={handleBaseUrlChange}
          onCorpusInstalled={handleCorpusInstalled}
          onCorpusRemoved={handleCorpusRemoved}
          onCatalogUpdated={(count) => {
            void refreshCatalog(false);
            setNotice(`Catalogue mis à jour (${count.toLocaleString("fr-FR")} œuvres).`);
          }}
        />
      )}

      {view === "settings" && (
        <SettingsPanel settings={settings} onUpdateSetting={update} onReset={reset} />
      )}
    </AppShell>
  );
}
