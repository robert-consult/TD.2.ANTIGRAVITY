export type InstantInput = string | number | Date | null | undefined;

type ParseLegacyInput = string | number | null | undefined;

function asDateOrNull(ms: number): Date | null {
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseLegacyDateInput(input: ParseLegacyInput): Date | null {
  if (!input) return null;

  if (typeof input === "number") {
    return asDateOrNull(input * 1000);
  }

  if (typeof input === "string") {
    const raw = input.trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
      return asDateOrNull(Number.parseInt(raw, 10) * 1000);
    }

    if (raw.includes(" ") && raw.includes(":")) {
      return asDateOrNull(Date.parse(raw.replace(" ", "T") + "Z"));
    }

    return asDateOrNull(Date.parse(raw));
  }

  return null;
}

export function coerceInstant(input: InstantInput): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return asDateOrNull(input.getTime());

  if (typeof input === "number") {
    const ms = Math.abs(input) < 1e12 ? input * 1000 : input;
    return asDateOrNull(ms);
  }

  if (typeof input === "string") {
    const raw = input.trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      const ms = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
      return asDateOrNull(ms);
    }
    return asDateOrNull(Date.parse(raw));
  }

  return null;
}

export function toUnixSeconds(input: InstantInput): number | null {
  const date = coerceInstant(input);
  if (!date) return null;
  return Math.trunc(date.getTime() / 1000);
}
