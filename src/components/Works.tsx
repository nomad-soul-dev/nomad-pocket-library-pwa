import { useEffect, useRef, useState } from "react";
import {
  deleteWork,
  listNotes,
  listWorks,
  saveNote,
  saveWork,
  deleteNote,
  type NoteRecord,
  type PersonalWork,
} from "../lib/storage";
import { countWords, excerpt } from "../lib/text";
import type { Oeuvre } from "../types";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Détection sans instanciation : évite de créer un objet à chaque rendu. */
function isDictationSupported(): boolean {
  return getRecognitionCtor() !== null;
}

function getRecognition(): SpeechRecognitionLike | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = "fr-FR";
  recognition.continuous = true;
  recognition.interimResults = true;
  return recognition;
}

export function Works({ onRead }: { onRead: (oeuvre: Oeuvre) => void }) {
  const [works, setWorks] = useState<PersonalWork[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [draft, setDraft] = useState<{ titre: string; auteur: string; genre: string; texte: string }>({
    titre: "",
    auteur: "",
    genre: "Écrit personnel",
    texte: "",
  });
  const [dictation, setDictation] = useState("");
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [sttAvailable] = useState(isDictationSupported);

  const refresh = () => {
    void listWorks().then(setWorks);
    void listNotes().then(setNotes);
  };

  useEffect(refresh, []);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  function startDictation() {
    const recognition = getRecognition();
    if (!recognition) {
      setStatus("La dictée vocale n'est pas disponible sur ce navigateur.");
      return;
    }
    recognitionRef.current = recognition;
    let final = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) final += `${transcript} `;
        else interim += transcript;
      }
      setDictation(`${final}${interim}`);
    };
    recognition.onerror = (event) => {
      setStatus(
        event.error === "not-allowed"
          ? "Microphone refusé : autorisez l'accès dans les réglages du navigateur."
          : `Dictée interrompue (${event.error ?? "inconnu"}).`
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
    setStatus(null);
  }

  function stopDictation() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function handleSaveWork() {
    if (!draft.titre.trim() || !draft.texte.trim()) {
      setStatus("Un titre et un texte sont nécessaires pour enregistrer.");
      return;
    }
    const now = Date.now();
    const work: PersonalWork = {
      id: `perso_${now.toString(36)}`,
      titre: draft.titre.trim(),
      auteur: draft.auteur.trim() || "Moi",
      type_genre: draft.genre.trim() || "Écrit personnel",
      texte: draft.texte,
      createdAt: now,
      updatedAt: now,
    };
    await saveWork(work);
    setDraft({ titre: "", auteur: "", genre: "Écrit personnel", texte: "" });
    setStatus(`« ${work.titre} » enregistré dans la bibliothèque personnelle.`);
    refresh();
  }

  function toOeuvre(work: PersonalWork): Oeuvre {
    const words = countWords(work.texte);
    return {
      id: work.id,
      titre: work.titre,
      auteur: work.auteur,
      dates_auteur: "",
      type_genre: work.type_genre,
      categories_tags: ["Écrit personnel"],
      tome: "",
      sources_disponibles: ["local"],
      texte_integral: work.texte,
      nb_mots: words,
      nb_caracteres: work.texte.length,
      temps_lecture_min: Math.max(1, Math.round(words / 180)),
      siecle: "—",
      mouvement_litteraire: "—",
    };
  }

  const inputStyle = {
    borderColor: "var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
  } as const;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold">Rédiger un texte</h2>
        <div className="mt-3 space-y-2">
          <input
            value={draft.titre}
            onChange={(e) => setDraft({ ...draft, titre: e.target.value })}
            placeholder="Titre"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
          <div className="flex gap-2">
            <input
              value={draft.auteur}
              onChange={(e) => setDraft({ ...draft, auteur: e.target.value })}
              placeholder="Auteur (par défaut : Moi)"
              className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              value={draft.genre}
              onChange={(e) => setDraft({ ...draft, genre: e.target.value })}
              placeholder="Genre"
              className="w-36 rounded-lg border px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <textarea
            value={draft.texte}
            onChange={(e) => setDraft({ ...draft, texte: e.target.value })}
            placeholder="Collez ou rédigez ici votre texte. Séparez les paragraphes par une ligne vide."
            rows={8}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
          <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
            {countWords(draft.texte).toLocaleString("fr-FR")} mots · {draft.texte.length.toLocaleString("fr-FR")} caractères
          </p>
          <button
            onClick={handleSaveWork}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Enregistrer dans mes écrits
          </button>
        </div>
      </section>

      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold">Prise de notes vocale</h2>
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
          {sttAvailable
            ? "Dictée via l'API SpeechRecognition du navigateur. Sur Android, la reconnaissance nécessite généralement une connexion (seules certaines voix téléchargées fonctionnent hors-ligne)."
            : "Dictée vocale non supportée par ce navigateur — utilisez la saisie clavier."}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={listening ? stopDictation : startDictation}
            disabled={!sttAvailable}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: listening ? "#b91c1c" : "var(--accent)" }}
          >
            {listening ? "⏹ Arrêter la dictée" : "🎤 Dicter"}
          </button>
          <button
            onClick={async () => {
              if (!dictation.trim()) return;
              await saveNote({
                id: `note_${Date.now().toString(36)}`,
                text: dictation.trim(),
                createdAt: Date.now(),
                source: "dictée",
              });
              setDictation("");
              refresh();
            }}
            className="rounded-xl border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--border)" }}
          >
            Enregistrer la note
          </button>
        </div>
        <textarea
          value={dictation}
          onChange={(e) => setDictation(e.target.value)}
          rows={4}
          placeholder="Le texte dicté apparaîtra ici (modifiable)."
          className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={inputStyle}
        />
        {notes.length > 0 && (
          <ul className="mt-3 space-y-2">
            {notes.map((note) => (
              <li
                key={note.id}
                className="rounded-xl border p-3 text-xs"
                style={{ borderColor: "var(--border)", background: "var(--bg)" }}
              >
                <p className="whitespace-pre-wrap">{note.text}</p>
                <div className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                  <span>{new Date(note.createdAt).toLocaleString("fr-FR")}</span>
                  <button
                    onClick={() => void navigator.clipboard?.writeText(note.text)}
                    className="underline"
                  >
                    copier
                  </button>
                  <button
                    onClick={async () => {
                      await deleteNote(note.id);
                      refresh();
                    }}
                    className="ml-auto underline"
                  >
                    supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <h2 className="text-sm font-semibold">Mes écrits ({works.length})</h2>
        {works.length === 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
            Aucun texte personnel pour l'instant.
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {works.map((work) => (
            <li
              key={work.id}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            >
              <p className="text-sm font-semibold leading-tight">{work.titre}</p>
              <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
                {work.auteur} · {countWords(work.texte).toLocaleString("fr-FR")} mots ·{" "}
                {new Date(work.updatedAt).toLocaleDateString("fr-FR")}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
                {excerpt(work.texte, 120)}
              </p>
              <div className="mt-2 flex items-center gap-3 text-[11px]">
                <button
                  onClick={() => onRead(toOeuvre(work))}
                  className="rounded-lg px-2.5 py-1 font-medium"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  Lire / écouter
                </button>
                <button
                  onClick={async () => {
                    await deleteWork(work.id);
                    refresh();
                  }}
                  className="underline"
                  style={{ color: "var(--text-dim)" }}
                >
                  supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {status && (
        <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
          {status}
        </p>
      )}
    </div>
  );
}
