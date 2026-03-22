import { db } from "@db";
import { systemConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { I18nConfig } from "./types";
import { ensureSystemConfigRow } from "../services/systemConfig";

const DEFAULT_SUPPORTED = [
  "en",
  "fr",
  "pt",
  "es",
  "de",
  "ar",
  "hi",
  "id",
  "zh",
  "ms",
  "tl",
  "ko",
  "ja",
  "sw",
  "th",
  "bn",
  "tr",
];

const DEFAULTS: I18nConfig = {
  enabled: true,
  defaultLocale: "en",
  supportedLocales: DEFAULT_SUPPORTED,
  autoTranslate: true,
  llmEnabled: true,
  llmProvider: "openai",
  llmModel: "gpt-4o-mini",
  llmMaxBatchSize: 50,
  llmMaxAttempts: 3,
};

function parseCsv(v: unknown): string[] {
  const raw = String(v ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return fallback;
}

function toInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeLocales(locales: string[], defaultLocale: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of locales) {
    const lc = String(l || "").trim();
    if (!lc) continue;
    const key = lc.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lc);
  }
  const defKey = String(defaultLocale || "en").toLowerCase();
  if (!seen.has(defKey)) out.unshift(defaultLocale || "en");
  return out;
}

let cachedConfig: I18nConfig | null = null;
let refreshPromise: Promise<I18nConfig> | null = null;

async function loadConfigFromDb(): Promise<I18nConfig> {
  try {
    const row = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.id, 1),
    });
    if (!row) return DEFAULTS;

    const defaultLocale = String((row as any).i18nDefaultLocale || DEFAULTS.defaultLocale);
    const supportedLocalesRaw = parseCsv((row as any).i18nSupportedLocalesCsv);
    const supportedLocales = normalizeLocales(
      supportedLocalesRaw.length ? supportedLocalesRaw : DEFAULTS.supportedLocales,
      defaultLocale,
    );

    return {
      enabled: toBool((row as any).i18nEnabled, DEFAULTS.enabled),
      defaultLocale,
      supportedLocales,
      autoTranslate: toBool((row as any).i18nAutoTranslate, DEFAULTS.autoTranslate),
      llmEnabled: toBool((row as any).i18nLlmEnabled, DEFAULTS.llmEnabled),
      llmProvider: String((row as any).i18nLlmProvider || DEFAULTS.llmProvider),
      llmModel: String((row as any).i18nLlmModel || DEFAULTS.llmModel),
      llmMaxBatchSize: Math.max(1, Math.min(200, toInt((row as any).i18nLlmMaxBatchSize, DEFAULTS.llmMaxBatchSize))),
      llmMaxAttempts: Math.max(1, Math.min(10, toInt((row as any).i18nLlmMaxAttempts, DEFAULTS.llmMaxAttempts))),
    };
  } catch {
    return DEFAULTS;
  }
}

export function getI18nConfig(): I18nConfig {
  if (cachedConfig) return cachedConfig;
  void refreshI18nConfig();
  return DEFAULTS;
}

export async function refreshI18nConfig(): Promise<I18nConfig> {
  if (!refreshPromise) {
    refreshPromise = loadConfigFromDb()
      .then((cfg) => {
        cachedConfig = cfg;
        return cfg;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function updateI18nConfig(
  patch: Partial<
    Pick<
      I18nConfig,
      | "enabled"
      | "defaultLocale"
      | "supportedLocales"
      | "autoTranslate"
      | "llmEnabled"
      | "llmProvider"
      | "llmModel"
      | "llmMaxBatchSize"
      | "llmMaxAttempts"
    >
  >,
): Promise<I18nConfig> {
  const cur = cachedConfig ?? (await loadConfigFromDb());

  const next: I18nConfig = {
    ...cur,
    ...patch,
    defaultLocale: patch.defaultLocale ? String(patch.defaultLocale) : cur.defaultLocale,
    supportedLocales: patch.supportedLocales ? patch.supportedLocales.map(String) : cur.supportedLocales,
  };

  const supportedLocales = normalizeLocales(next.supportedLocales, next.defaultLocale);
  const now = Math.floor(Date.now() / 1000);

  await ensureSystemConfigRow();
  await db
    .update(systemConfig)
    .set({
      i18nEnabled: next.enabled,
      i18nDefaultLocale: next.defaultLocale,
      i18nSupportedLocalesCsv: supportedLocales.join(","),
      i18nAutoTranslate: next.autoTranslate,
      i18nLlmEnabled: next.llmEnabled,
      i18nLlmProvider: next.llmProvider,
      i18nLlmModel: next.llmModel,
      i18nLlmMaxBatchSize: Math.max(1, Math.min(200, toInt(next.llmMaxBatchSize, DEFAULTS.llmMaxBatchSize))),
      i18nLlmMaxAttempts: Math.max(1, Math.min(10, toInt(next.llmMaxAttempts, DEFAULTS.llmMaxAttempts))),
      updatedAt: now,
      updatedBy: "admin_i18n",
    })
    .where(eq(systemConfig.id, 1));

  cachedConfig = {
    ...next,
    supportedLocales,
  };
  return cachedConfig;
}

export function getI18nPublicConfig() {
  const cfg = getI18nConfig();
  return { enabled: cfg.enabled, defaultLocale: cfg.defaultLocale, supportedLocales: cfg.supportedLocales };
}
