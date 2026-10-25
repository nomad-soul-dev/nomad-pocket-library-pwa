import { useCallback, useEffect, useState } from "react";
import type { ReaderSettings } from "../types";

const STORAGE_KEY = "nomad:reader-settings:v2";

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "sepia",
  fontSize: 19,
  lineHeight: 1.75,
  measure: 62,
  ttsRate: 1,
  ttsPitch: 1,
  autoPlay: false,
  followText: true,
  voiceURI: null,
};

function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings]);

  const update = useCallback(<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return { settings, update, reset };
}
