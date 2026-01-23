import { lazy, useLayoutEffect, useState } from "react";
import type { ComponentType } from "react";

type Listener = () => void;

let version = 0;
const listeners = new Set<Listener>();
let notifyScheduled = false;

function emit() {
  version += 1;
  try {
    (globalThis as any).__gravitonLazyPingVersion = version;
  } catch {
    // ignore
  }
  if (notifyScheduled) return;
  notifyScheduled = true;
  // Defer notifying React until the next task to avoid updates during render.
  setTimeout(() => {
    notifyScheduled = false;
    for (const listener of listeners) listener();
  }, 0);
}

export function subscribeLazyPing(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLazyPingSnapshot() {
  return version;
}

export function useLazyPing() {
  const [value, setValue] = useState(() => version);

  useLayoutEffect(() => {
    const listener = () => setValue(version);
    listeners.add(listener);
    // Catch any pings that happened before we subscribed.
    setValue(version);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return value;
}

/**
 * Workaround: ensure React.lazy + Suspense boundaries re-render when chunks resolve.
 * Some environments have been observed to miss the Suspense "ping" that should
 * occur when a lazy import resolves, leaving the fallback spinner stuck until a
 * separate state update happens.
 */
export function lazyWithPing<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    importer().then((module) => {
      emit();
      return module;
    }),
  );
}
