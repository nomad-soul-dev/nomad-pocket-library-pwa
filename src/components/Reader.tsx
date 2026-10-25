import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Oeuvre, ReaderSettings, ThemeName } from "../types";
import { kvGet, kvSet, saveBookmark, type BookmarkRecord } from "../lib/storage";
import {
  buildSpeechUnits,
  buildToc,
  clampIndex,
  countWords,
  excerpt,
  splitParagraphs,
  type SpeechUnit,
  type TocEntry,
} from "../lib/text";
import {
  frenchVoices,
  hasFrenchVoice,
  isTtsSupported,
  loadVoices,
  pickBestVoice,
  speechController,
  type TtsState,
} from "../lib/tts";
import { cn } from "../utils/cn";

/** Nombre de paragraphes affichés (et lus) par bloc : borne le DOM et la RAM. */
const PAGE_SIZE = 120;
const THEMES: { id: ThemeName; label: string; swatch: string }[] = [
  { id: "nuit", label: "Nuit", swatch: "#1b1c20" },
  { id: "sepia", label: "Sépia", swatch: "#f1e7d3" },
  { id: "matrix", label: "Matrix", swatch: "#0b0f0c" },
  { id: "clair", label: "Clair", swatch: "#f4f4f3" },
];

function progressKey(oeuvreId: string) {
  return `progress:${oeuvreId}`;
}

function Paragraph({
  text,
  range,
  active,
  speaking,
}: {
  text: string;
  range: { start: number; end: number } | null;
  active: boolean;
  speaking: boolean;
}) {
  if (!range || range.start >= range.end) {
    return <span className={cn(active && speaking && "font-medium")}>{text}</span>;
  }
  const before = text.slice(0, range.start);
  const middle = text.slice(range.start, range.end);
  const after = text.slice(range.end);
  return (
    <>
      {before}
      <mark
        style={{
          background: "transparent",
          color: "inherit",
          textDecoration: "underline",
          textDecorationColor: "var(--accent)",
          textDecorationThickness: "2px",
          textUnderlineOffset: "3px",
        }}
      >
        {middle}
      </mark>
      {after}
    </>
  );
}

export function Reader({
  oeuvre,
  initialParagraph,
  settings,
  onUpdateSetting,
  onBack,
}: {
  oeuvre: Oeuvre;
  initialParagraph: number | null;
  settings: ReaderSettings;
  onUpdateSetting: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void;
  onBack: () => void;
}) {
  const paragraphs = useMemo(() => splitParagraphs(oeuvre.texte_integral), [oeuvre.texte_integral]);
  const toc = useMemo<TocEntry[]>(() => buildToc(paragraphs), [paragraphs]);
  const charOffsets = useMemo(() => {
    const offsets = new Array<number>(paragraphs.length + 1);
    let total = 0;
    for (let i = 0; i < paragraphs.length; i += 1) {
      offsets[i] = total;
      total += paragraphs[i].length + 1;
    }
    offsets[paragraphs.length] = total;
    return offsets;
  }, [paragraphs]);

  const totalWords = useMemo(
    () => oeuvre.nb_mots || countWords(oeuvre.texte_integral),
    [oeuvre.nb_mots, oeuvre.texte_integral]
  );

  const [activeParagraph, setActiveParagraph] = useState(0);
  const [activeRange, setActiveRange] = useState<{ start: number; end: number } | null>(null);
  const [ttsState, setTtsState] = useState<TtsState>("idle");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<"none" | "sommaire" | "reglages">("none");
  const [toast, setToast] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const paragraphRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const lastSavedRef = useRef(0);
  const autoAdvanceRef = useRef(false);

  const ttsSupported = isTtsSupported();
  const frAvailable = hasFrenchVoice(voices);
  const totalPages = Math.max(1, Math.ceil(paragraphs.length / PAGE_SIZE));

  const visibleParagraphs = useMemo(
    () => paragraphs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [paragraphs, page]
  );
  const units = useMemo<SpeechUnit[]>(
    () =>
      buildSpeechUnits(visibleParagraphs).map((unit) => ({
        ...unit,
        paragraphIndex: unit.paragraphIndex + page * PAGE_SIZE,
      })),
    [visibleParagraphs, page]
  );

  const percent = useMemo(() => {
    if (paragraphs.length <= 1) return 0;
    return Math.round((charOffsets[activeParagraph] / charOffsets[paragraphs.length]) * 100);
  }, [activeParagraph, charOffsets, paragraphs.length]);

  const paragraphForPercent = useCallback(
    (pct: number) => {
      const target = (charOffsets[paragraphs.length] * pct) / 100;
      let low = 0;
      let high = paragraphs.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (charOffsets[mid] <= target) low = mid;
        else high = mid - 1;
      }
      return low;
    },
    [charOffsets, paragraphs.length]
  );

  const persist = useCallback(
    (paragraphIndex: number, unitIndex: number) => {
      const now = Date.now();
      if (now - lastSavedRef.current < 2500) return;
      lastSavedRef.current = now;
      void kvSet(progressKey(oeuvre.id), {
        oeuvreId: oeuvre.id,
        titre: oeuvre.titre,
        auteur: oeuvre.auteur,
        paragraphIndex,
        unitIndex,
        percent: Math.round((charOffsets[paragraphIndex] / (charOffsets[paragraphs.length] || 1)) * 100),
        updatedAt: now,
      });
      void kvSet("progress:last", oeuvre.id);
    },
    [charOffsets, oeuvre.auteur, oeuvre.id, oeuvre.titre, paragraphs.length]
  );

  /* --- Restauration de la position (marque-page automatique) --- */
  useEffect(() => {
    let cancelled = false;
    loadVoices().then((loaded) => {
      if (!cancelled) setVoices(loaded);
    });
    void kvGet<{ paragraphIndex: number }>(progressKey(oeuvre.id)).then((saved) => {
      if (cancelled) return;
      const index = clampIndex(
        initialParagraph ?? saved?.paragraphIndex ?? 0,
        paragraphs.length
      );
      setActiveParagraph(index);
      setPage(Math.floor(index / PAGE_SIZE));
      setRestored(true);
    });
    return () => {
      cancelled = true;
      speechController.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oeuvre.id, initialParagraph]);

  /* --- Contrôleur vocal --- */
  useEffect(() => {
    speechController.setCallbacks({
      onUnitStart: (unit, unitIndex) => {
        setActiveParagraph(unit.paragraphIndex);
        setActiveRange({ start: unit.start, end: unit.end });
        persist(unit.paragraphIndex, unitIndex);
        if (settings.followText) {
          const local = unit.paragraphIndex - page * PAGE_SIZE;
          paragraphRefs.current[local]?.scrollIntoView({ behavior: "smooth", block: "center" });
          if (unit.paragraphIndex >= (page + 1) * PAGE_SIZE - 2) {
            setPage((current) => Math.min(current + 1, totalPages - 1));
          }
        }
      },
      onStateChange: setTtsState,
      onEnd: () => {
        setActiveRange(null);
        if (autoAdvanceRef.current && page < totalPages - 1) {
          autoAdvanceRef.current = false;
          setPage((current) => Math.min(current + 1, totalPages - 1));
          window.setTimeout(() => speechController.play(units, 0), 80);
        }
      },
      onError: (message) => setTtsError(message),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oeuvre.id, page, persist, settings.followText, totalPages]);

  useEffect(() => {
    const voice = pickBestVoice(voices, settings.voiceURI);
    speechController.setVoice(voice);
  }, [voices, settings.voiceURI]);

  useEffect(() => {
    speechController.setRate(settings.ttsRate);
    speechController.setPitch(settings.ttsPitch);
  }, [settings.ttsRate, settings.ttsPitch]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* --- Lecture automatique à l'ouverture (option) --- */
  useEffect(() => {
    if (!restored || !settings.autoPlay || !ttsSupported || units.length === 0) return;
    const timer = window.setTimeout(() => {
      const start = units.findIndex((unit) => unit.paragraphIndex >= activeParagraph);
      speechController.play(units, start === -1 ? 0 : start);
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  const readFromParagraph = useCallback(
    (index: number) => {
      const safe = clampIndex(index, paragraphs.length);
      setActiveParagraph(safe);
      setTtsError(null);
      autoAdvanceRef.current = true;
      const targetPage = Math.floor(safe / PAGE_SIZE);
      if (targetPage !== page) setPage(targetPage);
      persist(safe, 0);
      if (!ttsSupported) {
        setToast("Synthèse vocale indisponible : lecture visuelle seule.");
        return;
      }
      const localStart = safe - targetPage * PAGE_SIZE;
      const unitIndex = units.findIndex((unit) => unit.paragraphIndex - page * PAGE_SIZE >= localStart);
      speechController.play(units, unitIndex === -1 ? 0 : unitIndex);
    },
    [page, paragraphs.length, persist, ttsSupported, units]
  );

  const togglePlay = useCallback(() => {
    setTtsError(null);
    if (ttsState === "idle") {
      autoAdvanceRef.current = true;
      speechController.play(units, speechController.getUnitIndex());
    } else {
      speechController.togglePlayPause();
    }
  }, [ttsState, units]);

  const addBookmark = useCallback(async () => {
    const text = paragraphs[activeParagraph] ?? "";
    const record: BookmarkRecord = {
      id: `${oeuvre.id}:${activeParagraph}:${Date.now()}`,
      oeuvreId: oeuvre.id,
      oeuvreTitre: oeuvre.titre,
      auteur: oeuvre.auteur,
      paragraphIndex: activeParagraph,
      excerpt: excerpt(text, 220),
      createdAt: Date.now(),
    };
    await saveBookmark(record);
    setToast("Extrait ajouté aux marque-pages.");
  }, [activeParagraph, oeuvre.auteur, oeuvre.id, oeuvre.titre, paragraphs]);

  const jumpToPercent = useCallback(
    (pct: number) => {
      readFromParagraph(paragraphForPercent(pct));
    },
    [paragraphForPercent, readFromParagraph]
  );

  const minutesLeft = useMemo(() => {
    const remainingChars =
      (charOffsets[paragraphs.length] - charOffsets[activeParagraph]) || 0;
    const totalChars = charOffsets[paragraphs.length] || 1;
    const minutes = (oeuvre.temps_lecture_min || Math.round(totalWords / 180)) * (remainingChars / totalChars);
    return Math.max(0, Math.round(minutes));
  }, [activeParagraph, charOffsets, oeuvre.temps_lecture_min, paragraphs.length, totalWords]);

  return (
    <div className="min-h-screen pb-32" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* En-tête */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2.5">
          <button
            onClick={() => {
              speechController.stop();
              persist(activeParagraph, speechController.getUnitIndex());
              onBack();
            }}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium"
            style={{ background: "var(--bg-elevated-2)" }}
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{oeuvre.titre}</p>
            <p className="truncate text-[11px]" style={{ color: "var(--text-dim)" }}>
              {oeuvre.auteur}
              {oeuvre.tome ? ` · ${oeuvre.tome}` : ""} · {percent}% · ~{minutesLeft} min restantes
            </p>
          </div>
          <button
            onClick={() => setPanel(panel === "sommaire" ? "none" : "sommaire")}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium"
            style={{ background: "var(--bg-elevated-2)" }}
            aria-label="Sommaire"
          >
            ☰
          </button>
          <button
            onClick={() => setPanel(panel === "reglages" ? "none" : "reglages")}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium"
            style={{ background: "var(--bg-elevated-2)" }}
            aria-label="Réglages de lecture"
          >
            Aa
          </button>
        </div>
        <div className="h-1 w-full" style={{ background: "var(--bg-elevated-2)" }}>
          <div className="h-full transition-all" style={{ width: `${percent}%`, background: "var(--accent)" }} />
        </div>
      </header>

      {/* Panneaux coulissants */}
      {panel !== "none" && (
        <div
          className="fixed inset-0 z-40 flex justify-end"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setPanel("none")}
        >
          <aside
            className="h-full w-[86%] max-w-sm overflow-y-auto p-4 scrollbar-thin"
            style={{ background: "var(--bg-elevated)" }}
            onClick={(event) => event.stopPropagation()}
          >
            {panel === "sommaire" ? (
              <>
                <h2 className="mb-3 text-sm font-semibold">Sommaire</h2>
                <button
                  onClick={() => jumpToPercent(0)}
                  className="mb-2 w-full rounded-lg px-3 py-2 text-left text-xs"
                  style={{ background: "var(--bg-elevated-2)" }}
                >
                  ⏮ Début
                </button>
                <ul className="space-y-1">
                  {toc.map((entry, index) => (
                    <li key={`${entry.index}-${index}`}>
                      <button
                        onClick={() => {
                          readFromParagraph(entry.index);
                          setPanel("none");
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs"
                        style={{ background: "var(--bg-elevated-2)", color: "var(--text)" }}
                      >
                        <span className="mr-1.5 opacity-50">{entry.kind === "bloc" ? "▪" : "✦"}</span>
                        {entry.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 grid grid-cols-4 gap-1.5">
                  {[0, 25, 50, 75, 100].map((value) => (
                    <button
                      key={value}
                      onClick={() => jumpToPercent(value)}
                      className="rounded-lg py-2 text-[11px]"
                      style={{ background: "var(--bg-elevated-2)" }}
                    >
                      {value}%
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold">Confort de lecture</h2>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => onUpdateSetting("theme", theme.id)}
                      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                      style={{
                        borderColor: "var(--border)",
                        background: theme.swatch,
                        color: theme.id === "sepia" || theme.id === "clair" ? "#2b2b29" : "#e4ddcf",
                        boxShadow: settings.theme === theme.id ? "0 0 0 2px var(--accent)" : undefined,
                      }}
                    >
                      <span className="h-3 w-3 rounded-full" style={{ background: "currentColor" }} />
                      {theme.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 space-y-3 text-xs" style={{ color: "var(--text-dim)" }}>
                  <label className="block">
                    Taille — {settings.fontSize}px
                    <input
                      type="range"
                      min={15}
                      max={30}
                      value={settings.fontSize}
                      onChange={(e) => onUpdateSetting("fontSize", Number(e.target.value))}
                      className="mt-1 w-full"
                      style={{ accentColor: "var(--accent)" }}
                    />
                  </label>
                  <label className="block">
                    Interlignage — {settings.lineHeight.toFixed(2)}
                    <input
                      type="range"
                      min={1.3}
                      max={2.3}
                      step={0.05}
                      value={settings.lineHeight}
                      onChange={(e) => onUpdateSetting("lineHeight", Number(e.target.value))}
                      className="mt-1 w-full"
                      style={{ accentColor: "var(--accent)" }}
                    />
                  </label>
                  <label className="block">
                    Largeur — {settings.measure}ch
                    <input
                      type="range"
                      min={38}
                      max={92}
                      value={settings.measure}
                      onChange={(e) => onUpdateSetting("measure", Number(e.target.value))}
                      className="mt-1 w-full"
                      style={{ accentColor: "var(--accent)" }}
                    />
                  </label>
                </div>
                <p className="mt-4 text-[11px]" style={{ color: "var(--text-dim)" }}>
                  Le texte est affiché par blocs de {PAGE_SIZE} paragraphes : le sommaire et les flèches
                  « bloc suivant » permettent de naviguer dans les œuvres très longues sans jamais
                  surcharger la mémoire.
                </p>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Corps du texte */}
      <main className="mx-auto max-w-3xl px-4 py-5">
        {!ttsSupported && (
          <p
            className="mb-4 rounded-xl border p-3 text-xs text-amber-600"
            style={{ borderColor: "var(--border)", background: "rgba(217,119,6,0.08)" }}
          >
            La synthèse vocale n'est pas disponible sur ce navigateur. La lecture visuelle reste
            intégralement fonctionnelle hors-ligne.
          </p>
        )}
        {ttsSupported && !frAvailable && voices.length > 0 && (
          <p
            className="mb-4 rounded-xl border p-3 text-xs text-amber-600"
            style={{ borderColor: "var(--border)", background: "rgba(217,119,6,0.08)" }}
          >
            Aucune voix française locale détectée : la lecture utilisera la voix par défaut de
            l'appareil. Installer une voix française (Réglages Android → Accessibilité → Sortie
            vocale) garantit une lecture hors-ligne de bonne qualité.
          </p>
        )}
        {ttsError && <p className="mb-4 text-xs text-red-500">{ttsError}</p>}

        <article
          className="mx-auto space-y-4"
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            maxWidth: `${settings.measure}ch`,
          }}
        >
          {visibleParagraphs.map((paragraph, localIndex) => {
            const globalIndex = page * PAGE_SIZE + localIndex;
            const isActive = globalIndex === activeParagraph;
            return (
              <p
                key={globalIndex}
                ref={(el) => {
                  paragraphRefs.current[localIndex] = el;
                }}
                onClick={() => readFromParagraph(globalIndex)}
                className={cn(
                  "cursor-pointer whitespace-pre-wrap rounded-lg p-2 -mx-2 transition-colors",
                  isActive && "paragraph-active"
                )}
              >
                {isActive && ttsState === "speaking" ? (
                  <Paragraph text={paragraph} range={activeRange} active={isActive} speaking />
                ) : (
                  paragraph
                )}
              </p>
            );
          })}
        </article>

        {paragraphs.length > PAGE_SIZE && (
          <div className="mx-auto mt-8 flex items-center justify-between" style={{ maxWidth: `${settings.measure}ch` }}>
            <button
              onClick={() => {
                setPage((current) => Math.max(0, current - 1));
                window.scrollTo({ top: 0 });
              }}
              disabled={page === 0}
              className="rounded-lg px-3 py-2 text-xs disabled:opacity-40"
              style={{ background: "var(--bg-elevated-2)" }}
            >
              ← Bloc précédent
            </button>
            <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
              Bloc {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => {
                setPage((current) => Math.min(totalPages - 1, current + 1));
                window.scrollTo({ top: 0 });
              }}
              disabled={page >= totalPages - 1}
              className="rounded-lg px-3 py-2 text-xs disabled:opacity-40"
              style={{ background: "var(--bg-elevated-2)" }}
            >
              Bloc suivant →
            </button>
          </div>
        )}
      </main>

      {toast && (
        <div
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-xs shadow-lg"
          style={{ background: "var(--accent)", color: "#14140f" }}
        >
          {toast}
        </div>
      )}

      {/* Mini-lecteur flottant */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-3xl border-t px-3 py-2.5 backdrop-blur-md"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => speechController.step(units, -1)}
            disabled={!ttsSupported}
            className="h-9 w-9 shrink-0 rounded-full text-sm disabled:opacity-40"
            style={{ background: "var(--bg-elevated-2)" }}
            aria-label="Phrase précédente"
          >
            ⏮
          </button>
          <button
            onClick={togglePlay}
            disabled={!ttsSupported}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base text-white shadow-md disabled:opacity-40"
            style={{ background: "var(--accent)" }}
            aria-label={ttsState === "speaking" ? "Pause" : "Lecture"}
          >
            {ttsState === "speaking" ? "⏸" : "▶"}
          </button>
          <button
            onClick={() => speechController.step(units, 1)}
            disabled={!ttsSupported}
            className="h-9 w-9 shrink-0 rounded-full text-sm disabled:opacity-40"
            style={{ background: "var(--bg-elevated-2)" }}
            aria-label="Phrase suivante"
          >
            ⏭
          </button>

          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={100}
              value={percent}
              onChange={(e) => jumpToPercent(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: "var(--accent)" }}
              aria-label="Position dans l'œuvre"
            />
            <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-dim)" }}>
              <span>
                ¶{activeParagraph + 1}/{paragraphs.length} · {settings.ttsRate.toFixed(2)}x
              </span>
              <span className="flex gap-2">
                <button onClick={addBookmark} className="underline">
                  🔖 extraire
                </button>
                <button
                  onClick={() => onUpdateSetting("followText", !settings.followText)}
                  className="underline"
                >
                  {settings.followText ? "suivi ✓" : "suivi ✗"}
                </button>
              </span>
            </div>
          </div>

          <button
            onClick={() =>
              onUpdateSetting("ttsRate", settings.ttsRate >= 2 ? 0.75 : Math.round((settings.ttsRate + 0.25) * 100) / 100)
            }
            className="h-9 shrink-0 rounded-full px-2.5 text-[11px] font-medium"
            style={{ background: "var(--bg-elevated-2)" }}
          >
            {settings.ttsRate.toFixed(2).replace(/0$/, "")}x
          </button>
        </div>

        {voices.length > 0 && (
          <select
            value={settings.voiceURI ?? ""}
            onChange={(e) => onUpdateSetting("voiceURI", e.target.value || null)}
            className="mt-1.5 w-full rounded-lg border px-2 py-1 text-[11px]"
            style={{ borderColor: "var(--border)", background: "var(--bg-elevated-2)", color: "var(--text)" }}
          >
            <option value="">Voix française automatique</option>
            {frenchVoices(voices).map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} {voice.localService ? "· locale" : "· réseau"}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
