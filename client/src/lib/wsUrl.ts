export function getWsUrl(): string {
  const raw =
    (import.meta as any).env?.VITE_WS_URL ||
    (import.meta as any).env?.VITE_APP_URL ||
    window.location.origin;

  const base = String(raw).trim().replace(/\/+$/, "");
  if (base.startsWith("ws://") || base.startsWith("wss://")) {
    return base.endsWith("/ws") ? base : `${base}/ws`;
  }
  if (base.startsWith("http://")) {
    const wsBase = `ws://${base.slice("http://".length)}`;
    return wsBase.endsWith("/ws") ? wsBase : `${wsBase}/ws`;
  }
  if (base.startsWith("https://")) {
    const wsBase = `wss://${base.slice("https://".length)}`;
    return wsBase.endsWith("/ws") ? wsBase : `${wsBase}/ws`;
  }
  return `ws://${base}/ws`;
}
