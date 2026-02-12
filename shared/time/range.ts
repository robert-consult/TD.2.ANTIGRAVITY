import { toUnixSeconds } from "./instant";

export type UnixSecondRange = {
  startAt: number | null;
  endAt: number | null;
};

function normalizeUnixSecond(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
}

export function normalizeUnixSecondRange(input: {
  startAt?: unknown;
  endAt?: unknown;
}): UnixSecondRange {
  return {
    startAt: normalizeUnixSecond(input.startAt),
    endAt: normalizeUnixSecond(input.endAt),
  };
}

export function isInstantWithinUnixSecondRange(
  instant: string | number | Date | null | undefined,
  range: UnixSecondRange,
): boolean {
  const ts = toUnixSeconds(instant);
  if (!Number.isFinite(ts)) return false;

  if (range.startAt != null && ts < range.startAt) return false;
  if (range.endAt != null && ts > range.endAt) return false;
  return true;
}
