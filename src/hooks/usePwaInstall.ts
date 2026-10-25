// Installation PWA — Nomad Pocket Library
//
// Objectif ergonomique : permettre l'installation sur l'écran d'accueil en un
// appui, sans passer par le menu Chrome (l'utilisateur visé n'est pas développeur).
//
// Points réels, sans supposition :
//  - `beforeinstallprompt` n'est émis par Chrome Android que si le manifeste, le
//    Service Worker et le HTTPS sont en ordre, et pas plus d'une fois par période.
//  - L'événement doit être conservé puis déclenché via `prompt()` dans un geste
//    utilisateur (d'où un bouton, pas un déclenchement automatique).
//  - Après installation, l'app doit cesser de proposer le bouton : on surveille
//    `appinstalled` et le mode d'affichage `standalone` / `matchmedia`.

import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia?.("(display-mode: standalone)");
  if (media?.matches) return true;
  // `navigator.standalone` existe sur iOS Safari uniquement.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return iosStandalone || new URLSearchParams(window.location.search).get("source") === "pwa";
}

export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(isRunningStandalone());
  const [dismissedAt, setDismissedAt] = useState<number>(() => {
    const raw = localStorage.getItem("nomad:install-dismissed");
    return raw ? Number(raw) : 0;
  });

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    const media = window.matchMedia?.("(display-mode: standalone)");
    const onDisplayMode = () => setInstalled(isRunningStandalone());
    media?.addEventListener?.("change", onDisplayMode);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      media?.removeEventListener?.("change", onDisplayMode);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPromptEvent(null);
  }, [promptEvent]);

  const dismiss = useCallback(() => {
    const now = Date.now();
    setDismissedAt(now);
    localStorage.setItem("nomad:install-dismissed", String(now));
  }, []);

  // On ne propose l'installation que si le navigateur l'a lui-même proposée
  // (événement capturé) et que l'utilisateur ne l'a pas écartée depuis 30 jours.
  const canInstall = !installed && promptEvent !== null && Date.now() - dismissedAt > 30 * 24 * 3600 * 1000;

  return { canInstall, installed, install, dismiss };
}
