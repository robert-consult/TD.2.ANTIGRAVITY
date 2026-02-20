export const WS_ENDPOINT_PATH = "/ws";
export const WS_PROTOCOL_VERSION = 1;

export const WS_MSG_AUTH_HELLO = "auth:hello";
export const WS_MSG_AUTH_OK = "auth:ok";
export const WS_MSG_QUOTES_SUBSCRIBE = "quotes:subscribe";
export const WS_MSG_QUOTES_UNSUBSCRIBE = "quotes:unsubscribe";
export const WS_MSG_QUOTES_SNAPSHOT = "quotes:snapshot";
export const WS_MSG_QUOTES_UPDATE = "quotes:update";
export const WS_MSG_TRADES_SUBSCRIBE = "trades:subscribe";
export const WS_MSG_TRADES_UNSUBSCRIBE = "trades:unsubscribe";
export const WS_MSG_TRADES_UPDATE = "trades:update";
export const WS_MSG_TRADES_UPDATED = "trades:updated";
export const WS_MSG_ACCOUNT_SUBSCRIBE = "account:subscribe";
export const WS_MSG_ACCOUNT_UNSUBSCRIBE = "account:unsubscribe";
export const WS_MSG_ACCOUNT_SNAPSHOT = "account:snapshot";
export const WS_MSG_ACCOUNT_UPDATE = "account:update";
export const WS_MSG_ACCOUNT_UPDATED = "account:updated";
export const WS_MSG_PING = "ping";
export const WS_MSG_PONG = "pong";
export const WS_MSG_ERROR = "ws:error";
export const WS_MSG_QUOTE_SUBSCRIPTIONS_UPDATED = "quote-subscriptions:updated";
export const WS_MSG_LEGAL_DOC1_UPDATED = "legal:doc1-updated";

export function resolveWsUrl(rawBase: string): string {
  const base = String(rawBase ?? "").trim().replace(/\/+$/, "");
  if (!base) return `ws://localhost${WS_ENDPOINT_PATH}`;
  if (base.startsWith("ws://") || base.startsWith("wss://")) {
    return base.endsWith(WS_ENDPOINT_PATH) ? base : `${base}${WS_ENDPOINT_PATH}`;
  }
  if (base.startsWith("http://")) {
    const wsBase = `ws://${base.slice("http://".length)}`;
    return wsBase.endsWith(WS_ENDPOINT_PATH) ? wsBase : `${wsBase}${WS_ENDPOINT_PATH}`;
  }
  if (base.startsWith("https://")) {
    const wsBase = `wss://${base.slice("https://".length)}`;
    return wsBase.endsWith(WS_ENDPOINT_PATH) ? wsBase : `${wsBase}${WS_ENDPOINT_PATH}`;
  }
  return `ws://${base}${WS_ENDPOINT_PATH}`;
}
