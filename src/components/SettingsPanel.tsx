import { useEffect, useRef, useState } from "react";
import type { ReaderSettings, ThemeName } from "../types";
import {
  kvGet,
  kvKeys,
  kvSet,
  listBookmarks,
  listNotes,
  listWorks,
  saveBookmark,
  saveNote,
  saveWork,
  type BookmarkRecord,
  type NoteRecord,
  type PersonalWork,
} from "../lib/storage";
import { frenchVoices, loadVoices, pickBestVoice, speechController } from "../lib/tts";
import { Diagnostics } from "./Diagnostics";
import { cn } from "../utils/cn";

const THEMES: { id: ThemeName; label: string; swatch: string; text: string }[] = [
  { id: "nuit", label: "Sombre mat", swatch: "#1b1c20", text: "#d8a657" },
  { id: "sepia", label: "Sépia", swatch: "#f1e7d3", text: "#3c2f22" },
  { id: "matrix", label: "Matrix", swatch: "#0b0f0c", text: "#4ddb6a" },
  { id: "clair", label: "Clair mat", swatch: "#f4f4f3", text: "#2b2b29" },
];

export function SettingsPanel({
  settings,
  onUpdateSetting,
  onReset,
}: {
  settings: ReaderSettings;
  onUpdateSetting: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void;
  onReset: () => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadVoices().then(setVoices);
  }, []);

  async function exportBackup() {
    const bookmarks = await listBookmarks();
    const works = await listWorks();
    const notes = await listNotes();
    const keys = await kvKeys();
    const progress: Record<string, unknown> = {};
    for (const key of keys) {
      if (key.startsWith("progress:")) {
        progress[key] = await kvGet<unknown>(key);
      }
    }
    const payload = {
      app: "nomad-pocket-library",
      format: 2,
      exportedAt: new Date().toISOString(),
      settings,
      bookmarks,
      works,
      notes,
      progress,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nomad_pocket_backup.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Sauvegarde générée : ${bookmarks.length} marque-pages, ${works.length} écrits, ${notes.length} notes.`);
  }

  async function importBackup(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as {
        bookmarks?: BookmarkRecord[];
        works?: PersonalWork[];
        notes?: NoteRecord[];
        progress?: Record<string, unknown>;
        settings?: Partial<ReaderSettings>;
      };
      for (const bookmark of payload.bookmarks ?? []) await saveBookmark(bookmark);
      for (const work of payload.works ?? []) await saveWork(work);
      for (const note of payload.notes ?? []) await saveNote(note);
      for (const [key, value] of Object.entries(payload.progress ?? {})) {
        if (key.startsWith("progress:")) await kvSet(key, value);
      }
      setStatus(
        `Restauration terminée : ${payload.bookmarks?.length ?? 0} marque-pages, ${payload.works?.length ?? 0} écrits, ${
          payload.notes?.length ?? 0
        } notes, ${Object.keys(payload.progress ?? {}).length} positions de lecture.`
      );
    } catch (err) {
      setStatus(`Échec de l'import : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const cardStyle = { borderColor: "var(--border)", background: "var(--bg-elevated)" } as const;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border p-4" style={cardStyle}>
        <h2 className="text-sm font-semibold">Thème</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => onUpdateSetting("theme", theme.id)}
              className={cn("flex items-center gap-2 rounded-xl border p-3 text-left text-xs font-medium")}
              style={{
                borderColor: "var(--border)",
                background: theme.swatch,
                color: theme.text,
                boxShadow: settings.theme === theme.id ? "0 0 0 2px var(--accent)" : undefined,
              }}
            >
              <span className="h-3.5 w-3.5 rounded-full" style={{ background: theme.text }} />
              {theme.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border p-4" style={cardStyle}>
        <h2 className="text-sm font-semibold">Typographie</h2>
        <div className="mt-3 space-y-4 text-xs" style={{ color: "var(--text-dim)" }}>
          {(
            [
              ["fontSize", "Taille du texte", 15, 30, 1, `${settings.fontSize}px`],
              ["lineHeight", "Interlignage", 1.3, 2.3, 0.05, settings.lineHeight.toFixed(2)],
              ["measure", "Largeur de lecture", 38, 92, 1, `${settings.measure}ch`],
              ["ttsRate", "Vitesse de lecture", 0.75, 2, 0.05, `${settings.ttsRate.toFixed(2)}x`],
              ["ttsPitch", "Tonalité", 0.6, 1.4, 0.05, settings.ttsPitch.toFixed(2)],
            ] as const
          ).map(([key, label, min, max, step, valueLabel]) => (
            <label key={key} className="block">
              {label} — {valueLabel}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={settings[key] as number}
                onChange={(e) => onUpdateSetting(key, Number(e.target.value) as never)}
                className="mt-1 w-full"
                style={{ accentColor: "var(--accent)" }}
              />
            </label>
          ))}
        </div>
        <div
          className="mt-4 rounded-xl border p-3"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg)",
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            maxWidth: `${settings.measure}ch`,
          }}
        >
          Aperçu — « Petit à petit, l'oiseau fait son nid. »
        </div>
      </section>

      <section className="rounded-2xl border p-4" style={cardStyle}>
        <h2 className="text-sm font-semibold">Lecture vocale</h2>
        <label className="mt-3 flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
          <input
            type="checkbox"
            checked={settings.autoPlay}
            onChange={(e) => onUpdateSetting("autoPlay", e.target.checked)}
          />
          Reprendre automatiquement la lecture à l'ouverture d'une œuvre
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
          <input
            type="checkbox"
            checked={settings.followText}
            onChange={(e) => onUpdateSetting("followText", e.target.checked)}
          />
          Suivre le texte automatiquement pendant l'écoute
        </label>

        {voices.length > 0 && (
          <label className="mt-3 block text-xs" style={{ color: "var(--text-dim)" }}>
            Voix par défaut
            <select
              value={settings.voiceURI ?? ""}
              onChange={(e) => onUpdateSetting("voiceURI", e.target.value || null)}
              className="mt-1 w-full rounded-lg border px-2 py-2 text-xs"
              style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
            >
              <option value="">Voix française automatique</option>
              {frenchVoices(voices).map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} {voice.localService ? "· locale (hors-ligne)" : "· réseau requis"}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          onClick={() => {
            const voice = pickBestVoice(voices, settings.voiceURI);
            speechController.setVoice(voice);
            speechController.setRate(settings.ttsRate);
            speechController.setPitch(settings.ttsPitch);
            const utterance = new SpeechSynthesisUtterance(
              "Bonjour. Voici un essai de la voix sélectionnée pour la lecture de vos œuvres."
            );
            if (voice) {
              utterance.voice = voice;
              utterance.lang = voice.lang;
            } else {
              utterance.lang = "fr-FR";
            }
            utterance.rate = settings.ttsRate;
            utterance.pitch = settings.ttsPitch;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);
          }}
          className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          🔊 Tester la voix et le débit
        </button>
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
          {voices.filter((v) => v.localService).length} voix locale(s) disponible(s) sur cet appareil
          — elles fonctionnent sans connexion.
        </p>
      </section>

      <section className="rounded-2xl border p-4" style={cardStyle}>
        <h2 className="text-sm font-semibold">Sauvegarde de mes données</h2>
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
          Le fichier JSON contient vos marque-pages, vos écrits, vos notes et vos positions de
          lecture. Le corpus littéraire (1,64 Go) n'est pas inclus : il se réinstalle séparément.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button
            onClick={exportBackup}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            ⬆️ Exporter mes données
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-xl border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--border)" }}
          >
            ⬇️ Importer une sauvegarde
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importBackup(file);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <button
            onClick={onReset}
            className="text-xs font-medium underline"
            style={{ color: "var(--text-dim)" }}
          >
            Rétablir les réglages par défaut
          </button>
        </div>
        {status && (
          <p className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--bg-elevated-2)" }}>
            {status}
          </p>
        )}
      </section>

      <Diagnostics />
    </div>
  );
}
