import { resolveWsUrl } from "@shared/ws/protocol";

export function getWsUrl(): string {
  const raw =
    (import.meta as any).env?.VITE_WS_URL ||
    (import.meta as any).env?.VITE_APP_URL ||
    window.location.origin;
  return resolveWsUrl(String(raw));
}
