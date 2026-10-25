import { useEffect, useState } from "react";
import { deleteBookmark, listBookmarks, type BookmarkRecord } from "../lib/storage";

export function Bookmarks({ onOpen }: { onOpen: (oeuvreId: string, paragraphIndex: number) => void }) {
  const [records, setRecords] = useState<BookmarkRecord[]>([]);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () => {
    void listBookmarks().then(setRecords);
  };

  useEffect(refresh, []);

  const filtered = records.filter((record) =>
    `${record.oeuvreTitre} ${record.auteur} ${record.excerpt}`.toLowerCase().includes(query.toLowerCase())
  );

  const grouped = filtered.reduce<Record<string, BookmarkRecord[]>>((acc, record) => {
    const key = record.auteur || "Auteur inconnu";
    (acc[key] ??= []).push(record);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer mes extraits…"
          className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
          style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
        />
        <p className="mt-1.5 px-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
          {records.length} extrait(s) enregistré(s), classés par auteur puis par titre.
        </p>
      </div>

      {records.length === 0 && (
        <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
          Aucun marque-page. Pendant la lecture, appuyez sur « 🔖 extraire » dans la barre du bas pour
          conserver un passage.
        </p>
      )}

      {Object.entries(grouped).map(([author, items]) => (
        <section key={author} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
            {author}
          </h2>
          {items
            .sort((a, b) => a.oeuvreTitre.localeCompare(b.oeuvreTitre, "fr"))
            .map((record) => (
              <article
                key={record.id}
                className="rounded-2xl border p-3.5"
                style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
              >
                <p className="text-sm font-semibold leading-tight">{record.oeuvreTitre}</p>
                <p
                  className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed"
                  style={{ color: "var(--text)" }}
                >
                  « {record.excerpt} »
                </p>
                <div className="mt-2.5 flex items-center gap-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                  <button
                    onClick={() => onOpen(record.oeuvreId, record.paragraphIndex)}
                    className="rounded-lg px-2.5 py-1 font-medium"
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                  >
                    Relire à cet endroit
                  </button>
                  <button
                    onClick={async () => {
                      await navigator.clipboard?.writeText(
                        `« ${record.excerpt} »\n— ${record.auteur}, ${record.oeuvreTitre}`
                      );
                      setCopied(record.id);
                      window.setTimeout(() => setCopied(null), 1500);
                    }}
                    className="underline"
                  >
                    {copied === record.id ? "copié ✓" : "copier"}
                  </button>
                  <button
                    onClick={async () => {
                      await deleteBookmark(record.id);
                      refresh();
                    }}
                    className="ml-auto underline"
                  >
                    supprimer
                  </button>
                </div>
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
