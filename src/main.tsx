import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Enregistrement du Service Worker (app shell + assets immuables du corpus).
// Volontairement silencieux en cas d'échec (ex. environnement de prévisualisation
// sans HTTPS) : la lecture hors-ligne des œuvres déjà installées ne dépend pas du SW,
// elle repose sur OPFS/IndexedDB (voir src/lib/storage.ts).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* non bloquant */
    });
  });
}

