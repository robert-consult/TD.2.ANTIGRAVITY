import { sha256Hex } from "../../services/crypto";

// Canonical JSON serialization with sorted keys for deterministic hashing.
export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((v) => stableStringify(v)).join(",")}]`;
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
  return `{${pairs.join(",")}}`;
}

export function chainHash(prevHash: string | null | undefined, payload: unknown): string {
  return sha256Hex(`${prevHash ?? ""}|${stableStringify(payload)}`);
}
