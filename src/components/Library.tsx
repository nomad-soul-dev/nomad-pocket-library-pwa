import { useMemo, useState } from "react";
import type { CatalogEntry, ReadingPosition } from "../types";
import { filterCatalog, uniqueValues, type SortKey } from "../lib/catalog";
import { formatMinutes } from "../lib/text";

export function Library({
  catalog,
  corpusReady,
  lastRead,
  onOpen,
  onGoToStorage,
}: {
  catalog: CatalogEntry[];
  corpusReady: boolean;
  lastRead: ReadingPosition | null;
  onOpen: (id: string) => void;
  onGoToStorage: () => void;
}) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [siecle, setSiecle] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("auteur");
  const [limit, setLimit] = useState(40);

  const genres = useMemo(() => uniqueValues(catalog, "g"), [catalog]);
  const siecles = useMemo(() => uniqueValues(catalog, "sec"), [catalog]);

  const filtered = useMemo(
    () => filterCatalog(catalog, { query, genre, siecle, mouvement: null, sort }),
    [catalog, query, genre, siecle, sort]
  );

  const visible = filtered.slice(0, limit);

  return (
    <div className="space-y-4">
      {lastRead && (
        <button
          onClick={() => onOpen(lastRead.oeuvreId)}
          className="w-full rounded-2xl border p-4 text-left"
          style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--accent)" }}>
            Reprendre la lecture
          </p>
          <p className="mt-1 text-sm font-semibold leading-tight">{lastRead.titre}</p>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            {lastRead.auteur} · {lastRead.percent}% parcouru
          </p>
        </button>
      )}

      <div className="space-y-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(40);
          }}
          placeholder="Rechercher un titre, un auteur, un genre…"
          className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
          style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
        />
        <div className="flex flex-wrap gap-2 text-[11px]">
          <select
            value={genre ?? ""}
            onChange={(e) => setGenre(e.target.value || null)}
            className="rounded-lg border px-2 py-1.5"
            style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
          >
            <option value="">Tous les genres</option>
            {genres.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={siecle ?? ""}
            onChange={(e) => setSiecle(e.target.value || null)}
            className="rounded-lg border px-2 py-1.5"
            style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
          >
            <option value="">Tous les siècles</option>
            {siecles.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border px-2 py-1.5"
            style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--text)" }}
          >
            <option value="auteur">Auteur</option>
            <option value="titre">Titre</option>
            <option value="longueur">Longueur</option>
          </select>
          <span className="ml-auto self-center" style={{ color: "var(--text-dim)" }}>
            {filtered.length.toLocaleString("fr-FR")} œuvre(s)
          </span>
        </div>
      </div>

      {catalog.length === 0 && (
        <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
          {corpusReady
            ? "Le catalogue est vide. Ouvrez l'onglet Stockage pour importer l'index du catalogue (catalog_index.json) ou le reconstruire depuis la base."
            : "Aucun corpus installé. Ouvrez l'onglet Stockage pour installer la bibliothèque (téléchargement ou import des fichiers présents sur l'appareil)."}
          <button
            onClick={onGoToStorage}
            className="mt-3 block rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            Ouvrir le gestionnaire de stockage →
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {visible.map((entry) => (
          <li key={entry.id}>
            <button
              onClick={() => onOpen(entry.id)}
              className="w-full rounded-xl border p-3.5 text-left transition-transform active:scale-[0.99]"
              style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold leading-snug">{entry.t}</p>
                  <p className="truncate text-xs" style={{ color: "var(--text-dim)" }}>
                    {entry.a}
                    {entry.d ? ` · ${entry.d}` : ""}
                  </p>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {entry.min > 0 ? formatMinutes(entry.min) : "—"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.g && (
                  <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--bg-elevated-2)", color: "var(--text-dim)" }}>
                    {entry.g}
                  </span>
                )}
                {entry.sec && (
                  <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--bg-elevated-2)", color: "var(--text-dim)" }}>
                    {entry.sec}
                  </span>
                )}
                {entry.mouv && entry.mouv !== "—" && (
                  <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--bg-elevated-2)", color: "var(--text-dim)" }}>
                    {entry.mouv}
                  </span>
                )}
                {entry.mots > 0 && (
                  <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--bg-elevated-2)", color: "var(--text-dim)" }}>
                    {entry.mots.toLocaleString("fr-FR")} mots
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {filtered.length > visible.length && (
        <button
          onClick={() => setLimit((current) => current + 40)}
          className="w-full rounded-xl border py-2.5 text-xs font-medium"
          style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
        >
          Afficher 40 œuvres de plus ({filtered.length - visible.length} restantes)
        </button>
      )}
    </div>
  );
}
