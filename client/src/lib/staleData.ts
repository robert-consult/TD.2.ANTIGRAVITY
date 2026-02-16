import { useSyncExternalStore } from "react";

const staleKeys = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function normalizeKey(key: string): string {
  return String(key || "").trim();
}

export function markStaleData(key: string): void {
  const normalized = normalizeKey(key);
  if (!normalized) return;
  if (staleKeys.has(normalized)) return;
  staleKeys.add(normalized);
  emit();
}

export function markFreshData(key: string): void {
  const normalized = normalizeKey(key);
  if (!normalized) return;
  if (!staleKeys.delete(normalized)) return;
  emit();
}

export function clearStaleData(keys?: string[]): void {
  if (!keys || keys.length === 0) {
    if (!staleKeys.size) return;
    staleKeys.clear();
    emit();
    return;
  }

  let changed = false;
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (!normalized) continue;
    if (staleKeys.delete(normalized)) changed = true;
  }
  if (changed) emit();
}

export function isDataStale(key: string): boolean {
  return staleKeys.has(normalizeKey(key));
}

export function useStaleData(keys: string | string[]): boolean {
  const normalizedKeys = Array.isArray(keys)
    ? keys.map((key) => normalizeKey(key)).filter(Boolean)
    : [normalizeKey(keys)].filter(Boolean);
  useSyncExternalStore(subscribeStaleData, getSnapshot, getSnapshot);
  return normalizedKeys.some((key) => staleKeys.has(key));
}

export function subscribeStaleData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return version;
}
