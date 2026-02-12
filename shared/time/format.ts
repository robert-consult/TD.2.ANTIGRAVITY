import { coerceInstant } from "./instant";

export type LocaleFormatOptions = {
  locale?: string;
  fallback?: string;
  options?: Intl.DateTimeFormatOptions;
};

export function formatInstantToLocaleString(
  input: string | number | Date | null | undefined,
  format?: LocaleFormatOptions,
): string {
  const fallback = format?.fallback ?? "-";
  const date = coerceInstant(input);
  if (!date) return fallback;
  return date.toLocaleString(format?.locale, format?.options);
}

export function formatUnixSecondsToLocaleString(
  utcSec: number | null | undefined,
  format?: LocaleFormatOptions,
): string {
  if (!Number.isFinite(Number(utcSec)) || Number(utcSec) <= 0) {
    return format?.fallback ?? "-";
  }
  return formatInstantToLocaleString(Number(utcSec) * 1000, format);
}

export function unixSecondsToLocalDateTimeInput(utcSec: number | null | undefined): string {
  const date = coerceInstant(utcSec == null ? null : Number(utcSec) * 1000);
  if (!date) return "";

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function localDateTimeInputToUnixSeconds(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return Math.trunc(ms / 1000);
}

export function formatRelativeTime(input: string | number | Date | null | undefined): string {
  const date = coerceInstant(input);
  if (!date) return "-";

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
