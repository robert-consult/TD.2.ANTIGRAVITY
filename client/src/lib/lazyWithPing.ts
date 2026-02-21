import { lazy } from "react";
import type { ComponentType } from "react";

type Listener = () => void;

export function subscribeLazyPing(listener: Listener) {
  void listener;
  return () => undefined;
}

export function getLazyPingSnapshot() {
  return 0;
}

export function useLazyPing() {
  return 0;
}

/**
 * Keep a stable import wrapper so call sites can continue using a single helper.
 * React.lazy already handles Suspense pings when chunks resolve.
 */
export function lazyWithPing<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(importer);
}
