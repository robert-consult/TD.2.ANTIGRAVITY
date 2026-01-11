/**
 * Timezone offset utilities for DST-aware UTC/GMT canonical format
 */

export function getOffsetMinutes(timeZone: string, date = new Date()): number {
  // Computes offset from UTC in minutes for given IANA zone at given date (DST-aware)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;

  // Build a UTC timestamp from the "local time in that zone"
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  // date.getTime() is actual UTC timestamp; difference gives offset
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function fmtUtcOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  // Canonical format: UTC±HH:MM (GMT±HH:MM)
  return `UTC${sign}${hh}:${mm} (GMT${sign}${hh}:${mm})`;
}
