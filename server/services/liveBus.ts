import { EventEmitter } from "events";
import type Redis from "ioredis";
import { getValkey } from "./valkey";

export type LiveEvent = {
  type: string;
  userId?: number;
  payload?: Record<string, any> | null;
  ts?: number;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

const lastEmitByKey = new Map<string, number>();
const LIVEBUS_CHANNEL = process.env.LIVEBUS_CHANNEL || "livebus:events";
const LIVEBUS_VALKEY_ENABLED = !["0", "false"].includes(
  String(process.env.LIVEBUS_VALKEY_ENABLED || "").toLowerCase()
);
const LIVEBUS_ORIGIN = `pid:${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let valkeySubscriber: Redis | null = null;
let valkeySubscribePending = false;
let valkeySubscribed = false;

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

function emitLocal(event: LiveEvent) {
  if (!shouldEmit(event)) return;
  emitter.emit("event", event);
}

function handleValkeyMessage(message: string) {
  try {
    const parsed = JSON.parse(message);
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.__origin && parsed.__origin === LIVEBUS_ORIGIN) return;
    const { __origin, ...rest } = parsed;
    const event = rest as LiveEvent;
    event.ts = typeof event.ts === "number" ? event.ts : Date.now();
    emitLocal(event);
  } catch {
    // ignore invalid payloads
  }
}

function ensureValkeySubscriber() {
  if (!LIVEBUS_VALKEY_ENABLED || valkeySubscribed || valkeySubscribePending) return;
  const base = getValkey();
  if (!base) return;
  valkeySubscribePending = true;
  valkeySubscriber = base.duplicate();
  valkeySubscriber.on("message", (channel, message) => {
    if (channel !== LIVEBUS_CHANNEL) return;
    handleValkeyMessage(message);
  });
  valkeySubscriber.on("error", () => {
    // silent by design
  });
  valkeySubscriber
    .subscribe(LIVEBUS_CHANNEL)
    .then(() => {
      valkeySubscribed = true;
    })
    .catch(() => {
      valkeySubscribed = false;
    })
    .finally(() => {
      valkeySubscribePending = false;
    });
}

export function publishLiveEvent(event: LiveEvent) {
  const ev: LiveEvent = { ...event, ts: event.ts ?? Date.now() };
  emitLocal(ev);

  if (!LIVEBUS_VALKEY_ENABLED) return;
  const v = getValkey();
  if (!v) return;
  const payload = JSON.stringify({ ...ev, __origin: LIVEBUS_ORIGIN });
  v.publish(LIVEBUS_CHANNEL, payload).catch(() => {
    // ignore publish errors, local emit already happened
  });
}

export function onLiveEvent(handler: (event: LiveEvent) => void) {
  ensureValkeySubscriber();
  emitter.on("event", handler);
  return () => emitter.off("event", handler);
}
