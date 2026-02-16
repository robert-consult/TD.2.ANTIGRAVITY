import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient } from "@/lib/queryClient";
import { initializeQueryPersistence } from "@/lib/queryPersistence";

function swEnabled(): boolean {
  if (import.meta.env.DEV) return false;
  const raw = import.meta.env.VITE_ENABLE_SW;
  if (raw == null) return true;
  return String(raw).trim().toLowerCase() !== "false";
}

function installServiceWorkerRegistration(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const enabled = swEnabled();
  window.addEventListener("load", () => {
    if (!enabled) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined);
      return;
    }

    void navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("[sw] registration failed", error);
    });
  });
}

async function bootstrap(): Promise<void> {
  installServiceWorkerRegistration();

  await initializeQueryPersistence(queryClient).catch(() => undefined);

  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
