import { EventEmitter } from "events";

export type LiveEvent = {
  type: string;
  userId?: number;
  payload?: Record<string, any> | null;
  ts?: number;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

const lastEmitByKey = new Map<string, number>();

function shouldEmit(event: LiveEvent): boolean {
  if (event.type === "account:updated" && typeof event.userId === "number") {
    const key = `account:updated:${event.userId}`;
    const now = Date.now();
    const last = lastEmitByKey.get(key) ?? 0;
    const minIntervalMs = Number(process.env.LIVE_ACCOUNT_THROTTLE_MS ?? 1000);
    if (now - last < minIntervalMs) return false;
    lastEmitByKey.set(key, now);
  }
  return true;
}

export function publishLiveEvent(event: LiveEvent) {
  const ev: LiveEvent = { ...event, ts: event.ts ?? Date.now() };
  if (!shouldEmit(ev)) return;
  emitter.emit("event", ev);
}

export function onLiveEvent(handler: (event: LiveEvent) => void) {
  emitter.on("event", handler);
  return () => emitter.off("event", handler);
}
