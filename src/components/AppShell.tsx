import { usePwaInstall } from "../hooks/usePwaInstall";
import { cn } from "../utils/cn";

export type View = "library" | "bookmarks" | "works" | "storage" | "settings";

const TABS: { id: View; label: string; icon: string }[] = [
  { id: "library", label: "Bibliothèque", icon: "📚" },
  { id: "bookmarks", label: "Marque-pages", icon: "🔖" },
  { id: "works", label: "Mes écrits", icon: "✍️" },
  { id: "storage", label: "Stockage", icon: "💾" },
  { id: "settings", label: "Réglages", icon: "⚙️" },
];

export function AppShell({
  view,
  onChange,
  corpusReady,
  catalogCount,
  children,
}: {
  view: View;
  onChange: (view: View) => void;
  corpusReady: boolean;
  catalogCount: number;
  children: React.ReactNode;
}) {
  const { canInstall, install, dismiss } = usePwaInstall();

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight">Nomad Pocket Library</h1>
            <p className="truncate text-[11px]" style={{ color: "var(--text-dim)" }}>
              {corpusReady
                ? `${catalogCount > 0 ? `${catalogCount.toLocaleString("fr-FR")} œuvres · ` : ""}lecture hors-ligne active`
                : "corpus non installé"}
            </p>
          </div>
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full",
              corpusReady ? "bg-emerald-500" : "bg-amber-500 animate-pulse-soft"
            )}
            title={corpusReady ? "Corpus installé" : "En attente d'installation"}
          />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">{children}</main>

      {canInstall && (
        <div
          className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5"
          style={{ background: "color-mix(in srgb, var(--bg-elevated) 96%, transparent)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-tight">Installer la bibliothèque</p>
            <p className="text-[11px] leading-tight" style={{ color: "var(--text-dim)" }}>
              Ajouter à l'écran d'accueil pour un accès hors-ligne en un appui.
            </p>
          </div>
          <button
            onClick={() => void install()}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Installer
          </button>
          <button
            onClick={dismiss}
            className="shrink-0 px-1 text-xs"
            style={{ color: "var(--text-dim)" }}
            aria-label="Ne plus proposer"
          >
            ✕
          </button>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md"
        style={{
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="mx-auto flex max-w-3xl">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-opacity",
                view === tab.id ? "opacity-100" : "opacity-55"
              )}
              style={{ color: view === tab.id ? "var(--accent)" : "var(--text)" }}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
