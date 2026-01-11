// Quote session-day helpers
//
// FX platforms typically define a "trading day" boundary (e.g. 5pm New York).
// We model this as a rollover time (HH:MM) in a specific time zone.
//
// The returned sessionDay is a YYYY-MM-DD string in the *session start day*
// (i.e., the local date at the rollover boundary).
export type FxRolloverConfig = {
  tz: string; // IANA TZ, e.g. "America/New_York"
  time: string; // "HH:MM" 24h, e.g. "17:00"
};

const DEFAULT_TZ = "America/New_York";
const DEFAULT_TIME = "17:00";

export function normalizeFxRolloverConfig(input?: Partial<FxRolloverConfig>) {
  const tz = (input?.tz || DEFAULT_TZ).trim() || DEFAULT_TZ;
  const time = (input?.time || DEFAULT_TIME).trim() || DEFAULT_TIME;
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return { tz, time: DEFAULT_TIME };
  }
  return { tz, time };
}

export function parseRolloverMinutes(hhmm: string) {
  const m = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return 17 * 60;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh * 60 + mm;
}

type LocalParts = { y: number; mo: number; d: number; hh: number; mm: number };

function getLocalParts(tsMs: number, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(tsMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    y: Number(map.year),
    mo: Number(map.month),
    d: Number(map.day),
    hh: Number(map.hour),
    mm: Number(map.minute),
  };
}

function ymd(y: number, mo: number, d: number): string {
  const mm = String(mo).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function prevYmd(day: string): string {
  const dt = new Date(`${day}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Compute the session day key for a given timestamp.
 */
export function computeSessionDay(tsMs: number, cfg?: Partial<FxRolloverConfig>) {
  const { tz, time } = normalizeFxRolloverConfig(cfg);
  const cutoff = parseRolloverMinutes(time);
  const lp = getLocalParts(tsMs, tz);
  const today = ymd(lp.y, lp.mo, lp.d);
  const minutes = lp.hh * 60 + lp.mm;
  return minutes < cutoff ? prevYmd(today) : today;
}

export function computeCurrentSessionDay(cfg?: Partial<FxRolloverConfig>) {
  return computeSessionDay(Date.now(), cfg);
}
