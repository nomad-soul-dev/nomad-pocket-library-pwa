import { cn } from "../utils/cn";

export type View = "library" | "import" | "settings" | "diagnostics";

const TABS: { id: View; label: string; icon: string }[] = [
  { id: "library", label: "Bibliothèque", icon: "📚" },
  { id: "import", label: "Stockage", icon: "📥" },
  { id: "settings", label: "Réglages", icon: "🎛️" },
  { id: "diagnostics", label: "Diagnostic", icon: "🩺" },
];

export function TopNav({
  view,
  onChange,
  corpusReady,
}: {
  view: View;
  onChange: (v: View) => void;
  corpusReady: boolean;
}) {
  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-md"
      style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-xl" />
          <div>
            <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text)" }}>
              Nomad Pocket Library
            </p>
            <p className="text-[11px] leading-tight" style={{ color: "var(--text-dim)" }}>
              {corpusReady ? "Corpus installé · lecture hors-ligne" : "Corpus non installé"}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            corpusReady ? "bg-emerald-500" : "bg-amber-500 animate-pulse-soft"
          )}
          title={corpusReady ? "Corpus prêt" : "En attente d'installation"}
        />
      </div>
      <nav className="mx-auto flex max-w-3xl gap-1 px-3 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
              view === tab.id ? "shadow-sm" : "opacity-60 hover:opacity-100"
            )}
            style={{
              background: view === tab.id ? "var(--bg-elevated-2)" : "transparent",
              color: "var(--text)",
            }}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
