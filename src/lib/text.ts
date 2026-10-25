// Découpage du texte — Nomad Pocket Library
//
// Le texte intégral d'une œuvre peut atteindre plusieurs mégaoctets. On ne le
// découpe qu'une fois en paragraphes, et le lecteur n'affiche qu'une fenêtre
// réduite autour de la position courante : le DOM reste léger même sur une
// œuvre très longue (text reflow virtuel exigé par le cahier des charges).

export interface TocEntry {
  index: number;
  label: string;
  kind: "titre" | "bloc";
}

/** Découpe en paragraphes, en préservant les retours à la ligne internes (vers). */
export function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  let parts = normalized
    .split(/\n[ \t]*\n+/)
    .map((part) => part.replace(/[ \t]+$/g, "").trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    parts = normalized
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return parts;
}

const CHAPTER_WORD =
  /^(chapitre|livre|chant|acte|scène|scene|partie|fable|poème|poesie|poésie|conte|nouvelle|préface|preface|avertissement|prologue|épilogue|epilogue|lettre|sonnet|ballade|ode|élégie|elegie|chanson|strophe|cantique|psaume|verset|dialogue|récit|recit|chap\.|tome|volume|première partie|seconde partie|troisième partie|quatrième partie)\b/i;

const ROMAN = /^[IVXLCDM]{1,7}[\.\s—–-]*$/i;

function looksLikeHeading(paragraph: string): boolean {
  if (paragraph.length === 0 || paragraph.length > 90) return false;
  const letters = paragraph.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return false;
  if (CHAPTER_WORD.test(paragraph)) return true;
  if (ROMAN.test(paragraph.trim())) return true;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  // Titre en capitales (classique chez Gutenberg), sans ponctuation finale.
  if (upper / letters.length > 0.8 && !/[.,;!?…]$/.test(paragraph.trim())) return true;
  return false;
}

function cleanLabel(paragraph: string): string {
  return paragraph.replace(/\s+/g, " ").trim().slice(0, 70);
}

/**
 * Sommaire interactif. On détecte d'abord les titres réels ; si l'œuvre n'en
 * présente pas assez (poésie, recueils, textes continus), on construit des
 * blocs réguliers afin que la navigation granulaire reste toujours possible.
 */
export function buildToc(paragraphs: string[]): TocEntry[] {
  const entries: TocEntry[] = [];
  for (let i = 0; i < paragraphs.length && entries.length < 300; i += 1) {
    if (looksLikeHeading(paragraphs[i])) {
      entries.push({ index: i, label: cleanLabel(paragraphs[i]), kind: "titre" });
    }
  }
  if (entries.length >= 2) return entries;

  const blockSize = Math.max(8, Math.ceil(paragraphs.length / 16));
  for (let i = 0; i < paragraphs.length; i += blockSize) {
    entries.push({
      index: i,
      label: `Passage ${Math.floor(i / blockSize) + 1}`,
      kind: "bloc",
    });
  }
  return entries;
}

export interface TextRange {
  start: number;
  end: number;
  text: string;
}

/** Découpe un bloc en phrases (indices de caractères conservés pour le surlignage). */
export function splitSentences(text: string): TextRange[] {
  const units: TextRange[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?" || ch === "…") {
      let end = i + 1;
      while (end < text.length && /[»”')\]\s]/.test(text[end])) end += 1;
      const chunk = text.slice(start, end);
      if (chunk.trim()) units.push({ start, end, text: chunk.trim() });
      start = end;
      i = end - 1;
    }
  }
  const tail = text.slice(start);
  if (tail.trim()) units.push({ start, end: text.length, text: tail.trim() });
  return units;
}

export interface SpeechUnit extends TextRange {
  paragraphIndex: number;
}

/**
 * Unités de lecture : une phrase par utterance. Un `SpeechSynthesisUtterance`
 * trop long est tronqué ou ignoré par certains moteurs Android ; rester au
 * niveau de la phrase rend aussi la pause/reprise nettement plus fiable.
 * Les blocs très longs (sans ponctuation) sont découpés sur les virgules.
 */
export function buildSpeechUnits(paragraphs: string[], maxChars = 340): SpeechUnit[] {
  const units: SpeechUnit[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const sentences = splitSentences(paragraph);
    for (const sentence of sentences) {
      if (sentence.text.length <= maxChars) {
        units.push({ ...sentence, paragraphIndex });
        continue;
      }
      let offset = sentence.start;
      const pieces = sentence.text.split(/(?<=[,;:])\s+/);
      let buffer = "";
      let bufferStart = offset;
      for (const piece of pieces) {
        if ((buffer + " " + piece).trim().length > maxChars && buffer) {
          units.push({
            start: bufferStart,
            end: bufferStart + buffer.length,
            text: buffer.trim(),
            paragraphIndex,
          });
          buffer = piece;
          bufferStart = offset;
        } else {
          buffer = buffer ? `${buffer} ${piece}` : piece;
        }
        offset += piece.length + 1;
      }
      if (buffer.trim()) {
        units.push({
          start: bufferStart,
          end: bufferStart + buffer.length,
          text: buffer.trim(),
          paragraphIndex,
        });
      }
    }
  });
  return units;
}

export function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}'’-]+/gu);
  return matches ? matches.length : 0;
}

export function excerpt(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(value, length - 1));
}

export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}
