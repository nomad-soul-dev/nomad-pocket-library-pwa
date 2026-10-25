// Synthèse vocale — Nomad Pocket Library (Étape 2)
//
// Priorité absolue : hors-ligne, avec les voix locales de l'appareil via
// `window.speechSynthesis`. Aucun service réseau n'est sollicité.
//
// Granularité retenue : LA PHRASE. Motivation (conforme au cahier des charges) :
//  - l'événement `onboundary` (mot à mot) n'est pas émis de façon constante par
//    tous les moteurs vocaux Android ; on l'utilise quand il arrive, sans en
//    dépendre ;
//  - `pause()`/`resume()` de speechSynthesis sont notoirement capricieux sur
//    Android (pause ignorée, resume sans effet). En gardant une unité courte, on
//    peut garantir une reprise nette : « Re-cliquer sur Play reprend la phrase. »

import type { SpeechUnit } from "./text";

export type TtsState = "idle" | "speaking" | "paused";

export interface TtsCallbacks {
  onUnitStart?: (unit: SpeechUnit, unitIndex: number) => void;
  onStateChange?: (state: TtsState) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export function isTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!isTtsSupported()) return Promise.resolve([]);
  if (voicesPromise) return voicesPromise;

  voicesPromise = new Promise((resolve) => {
    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length > 0) {
      cachedVoices = immediate;
      resolve(immediate);
      return;
    }
    const handle = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        cachedVoices = voices;
        window.speechSynthesis.removeEventListener("voiceschanged", handle);
        resolve(voices);
      }
    };
    window.speechSynthesis.addEventListener("voiceschanged", handle);
    // Certains WebView Android ne déclenchent jamais l'événement.
    setTimeout(() => {
      cachedVoices = window.speechSynthesis.getVoices();
      resolve(cachedVoices);
    }, 1500);
  });

  return voicesPromise;
}

export function frenchVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const fr = voices.filter((v) => v.lang?.toLowerCase().startsWith("fr"));
  return fr.length > 0 ? fr : voices;
}

export function hasFrenchVoice(voices: SpeechSynthesisVoice[]): boolean {
  return voices.some((v) => v.lang?.toLowerCase().startsWith("fr"));
}

export function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  preferredURI?: string | null
): SpeechSynthesisVoice | null {
  if (preferredURI) {
    const match = voices.find((v) => v.voiceURI === preferredURI);
    if (match) return match;
  }
  const fr = voices.filter((v) => v.lang?.toLowerCase().startsWith("fr"));
  const local = fr.find((v) => v.localService);
  return local ?? fr[0] ?? voices[0] ?? null;
}

export class SpeechController {
  private units: SpeechUnit[] = [];
  private index = 0;
  private rate = 1;
  private pitch = 1;
  private voice: SpeechSynthesisVoice | null = null;
  private state: TtsState = "idle";
  private callbacks: TtsCallbacks = {};
  private cancelled = false;
  private timers: number[] = [];

  setCallbacks(callbacks: TtsCallbacks) {
    this.callbacks = callbacks;
  }

  setRate(rate: number) {
    this.rate = rate;
    // Limite connue de l'API : `rate` ne peut pas être modifié sur une énonciation
    // déjà en cours. Il s'applique à partir de la phrase suivante.
  }

  setPitch(pitch: number) {
    this.pitch = pitch;
  }

  setVoice(voice: SpeechSynthesisVoice | null) {
    this.voice = voice;
  }

  getState(): TtsState {
    return this.state;
  }

  getUnitIndex(): number {
    return this.index;
  }

  findUnitForParagraph(paragraphIndex: number): number {
    const found = this.units.findIndex((unit) => unit.paragraphIndex >= paragraphIndex);
    return found === -1 ? Math.max(0, this.units.length - 1) : found;
  }

  private clearTimers() {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers = [];
  }

  private setState(state: TtsState) {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }

  /** Démarre la lecture à partir d'une unité donnée (ou de la position courante). */
  play(units: SpeechUnit[], startIndex = this.index) {
    if (!isTtsSupported()) {
      this.callbacks.onError?.("La synthèse vocale n'est pas disponible sur ce navigateur.");
      return;
    }
    this.units = units;
    this.cancelled = false;
    this.index = Math.max(0, Math.min(startIndex, Math.max(0, units.length - 1)));
    this.clearTimers();
    window.speechSynthesis.cancel();
    this.speakCurrent();
  }

  private speakCurrent() {
    if (this.cancelled) return;
    if (this.index >= this.units.length) {
      this.setState("idle");
      this.callbacks.onEnd?.();
      return;
    }

    const unit = this.units[this.index];
    if (!unit || !unit.text.trim()) {
      this.index += 1;
      this.speakCurrent();
      return;
    }

    this.callbacks.onUnitStart?.(unit, this.index);

    const utterance = new SpeechSynthesisUtterance(unit.text);
    if (this.voice) {
      utterance.voice = this.voice;
      utterance.lang = this.voice.lang;
    } else {
      utterance.lang = "fr-FR";
    }
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;

    utterance.onend = () => {
      if (this.cancelled) return;
      this.index += 1;
      // Laisser respirer le moteur : certains moteurs Android abandonnent si on
      // enchaîne les énonciations sans le moindre délai.
      this.timers.push(window.setTimeout(() => this.speakCurrent(), 40));
    };

    utterance.onerror = (event) => {
      if (this.cancelled) return;
      if (event.error === "interrupted" || event.error === "canceled") return;
      this.callbacks.onError?.(`Erreur de synthèse vocale : ${event.error}`);
      this.setState("idle");
    };

    this.setState("speaking");
    window.speechSynthesis.speak(utterance);
  }

  /**
   * Pause : on tente d'abord la pause native (coupe au milieu de la phrase).
   * Si le moteur ne la respecte pas (cas recensé sur Android), on arrête net et
   * on conserve l'index : la reprise repartira du début de la phrase courante.
   */
  pause() {
    if (!isTtsSupported() || this.state !== "speaking") return;
    window.speechSynthesis.pause();
    this.timers.push(
      window.setTimeout(() => {
        if (this.state !== "speaking") return;
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.cancel();
        }
        this.setState("paused");
      }, 220)
    );
  }

  /** Reprise : reprend la phrase interrompue, ou la relance depuis son début. */
  resume() {
    if (!isTtsSupported() || this.state !== "paused") return;
    window.speechSynthesis.resume();
    this.setState("speaking");
    this.timers.push(
      window.setTimeout(() => {
        if (this.state !== "speaking" || this.cancelled) return;
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          this.speakCurrent();
        }
      }, 400)
    );
  }

  togglePlayPause() {
    if (this.state === "speaking") this.pause();
    else if (this.state === "paused") this.resume();
    else if (this.units.length > 0) this.play(this.units, this.index);
  }

  /** Déplacement demandé par l'utilisateur (clic sur un autre paragraphe). */
  jumpToParagraph(units: SpeechUnit[], paragraphIndex: number) {
    this.play(units, this.findUnitForParagraph(paragraphIndex));
  }

  jumpToUnit(units: SpeechUnit[], unitIndex: number) {
    this.play(units, unitIndex);
  }

  /** Phrase suivante / précédente (commandes du mini-lecteur). */
  step(units: SpeechUnit[], delta: number) {
    const target = Math.max(0, Math.min(this.index + delta, Math.max(0, units.length - 1)));
    this.play(units, target);
  }

  stop() {
    this.cancelled = true;
    this.clearTimers();
    if (isTtsSupported()) window.speechSynthesis.cancel();
    this.setState("idle");
  }
}

export const speechController = new SpeechController();
