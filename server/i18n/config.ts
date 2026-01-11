import { withI18nDb } from "./i18nDb";
import type { I18nConfig } from "./types";

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

export function getI18nConfig(): I18nConfig {
  try {
    return withI18nDb((db) => {
      const row = db
        .prepare(
          `
          SELECT
            i18n_enabled,
            i18n_default_locale,
            i18n_supported_locales_csv,
            i18n_auto_translate,
            i18n_llm_enabled,
            i18n_llm_provider,
            i18n_llm_model,
            i18n_llm_max_batch_size,
            i18n_llm_max_attempts
          FROM system_config
          WHERE id = 1
        `,
        )
        .get() as any;

      const defaultLocale = String(row?.i18n_default_locale || DEFAULTS.defaultLocale);
      const supportedLocalesRaw = parseCsv(row?.i18n_supported_locales_csv);
      const supportedLocales = normalizeLocales(
        supportedLocalesRaw.length ? supportedLocalesRaw : DEFAULTS.supportedLocales,
        defaultLocale,
      );

      return {
        enabled: toBool(row?.i18n_enabled, DEFAULTS.enabled),
        defaultLocale,
        supportedLocales,
        autoTranslate: toBool(row?.i18n_auto_translate, DEFAULTS.autoTranslate),
        llmEnabled: toBool(row?.i18n_llm_enabled, DEFAULTS.llmEnabled),
        llmProvider: String(row?.i18n_llm_provider || DEFAULTS.llmProvider),
        llmModel: String(row?.i18n_llm_model || DEFAULTS.llmModel),
        llmMaxBatchSize: Math.max(1, Math.min(200, toInt(row?.i18n_llm_max_batch_size, DEFAULTS.llmMaxBatchSize))),
        llmMaxAttempts: Math.max(1, Math.min(10, toInt(row?.i18n_llm_max_attempts, DEFAULTS.llmMaxAttempts))),
      };
    });
  } catch {
    return DEFAULTS;
  }
}

export function updateI18nConfig(
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
): I18nConfig {
  return withI18nDb((db) => {
    const row = db
      .prepare(
        `
        SELECT
          i18n_enabled,
          i18n_default_locale,
          i18n_supported_locales_csv,
          i18n_auto_translate,
          i18n_llm_enabled,
          i18n_llm_provider,
          i18n_llm_model,
          i18n_llm_max_batch_size,
          i18n_llm_max_attempts
        FROM system_config
        WHERE id = 1
      `,
      )
      .get() as any;

    const cur: I18nConfig = {
      enabled: toBool(row?.i18n_enabled, DEFAULTS.enabled),
      defaultLocale: String(row?.i18n_default_locale || DEFAULTS.defaultLocale),
      supportedLocales: normalizeLocales(
        parseCsv(row?.i18n_supported_locales_csv).length
          ? parseCsv(row?.i18n_supported_locales_csv)
          : DEFAULTS.supportedLocales,
        String(row?.i18n_default_locale || DEFAULTS.defaultLocale),
      ),
      autoTranslate: toBool(row?.i18n_auto_translate, DEFAULTS.autoTranslate),
      llmEnabled: toBool(row?.i18n_llm_enabled, DEFAULTS.llmEnabled),
      llmProvider: String(row?.i18n_llm_provider || DEFAULTS.llmProvider),
      llmModel: String(row?.i18n_llm_model || DEFAULTS.llmModel),
      llmMaxBatchSize: Math.max(1, Math.min(200, toInt(row?.i18n_llm_max_batch_size, DEFAULTS.llmMaxBatchSize))),
      llmMaxAttempts: Math.max(1, Math.min(10, toInt(row?.i18n_llm_max_attempts, DEFAULTS.llmMaxAttempts))),
    };

    const next: I18nConfig = {
      ...cur,
      ...patch,
      defaultLocale: patch.defaultLocale ? String(patch.defaultLocale) : cur.defaultLocale,
      supportedLocales: patch.supportedLocales ? patch.supportedLocales.map(String) : cur.supportedLocales,
    };

    const supportedLocales = normalizeLocales(next.supportedLocales, next.defaultLocale);

    db.prepare(
      `
      UPDATE system_config SET
        i18n_enabled = @i18n_enabled,
        i18n_default_locale = @i18n_default_locale,
        i18n_supported_locales_csv = @i18n_supported_locales_csv,
        i18n_auto_translate = @i18n_auto_translate,
        i18n_llm_enabled = @i18n_llm_enabled,
        i18n_llm_provider = @i18n_llm_provider,
        i18n_llm_model = @i18n_llm_model,
        i18n_llm_max_batch_size = @i18n_llm_max_batch_size,
        i18n_llm_max_attempts = @i18n_llm_max_attempts,
        updated_at = (strftime('%s', 'now'))
      WHERE id = 1
    `,
    ).run({
      i18n_enabled: next.enabled ? 1 : 0,
      i18n_default_locale: next.defaultLocale,
      i18n_supported_locales_csv: supportedLocales.join(","),
      i18n_auto_translate: next.autoTranslate ? 1 : 0,
      i18n_llm_enabled: next.llmEnabled ? 1 : 0,
      i18n_llm_provider: next.llmProvider,
      i18n_llm_model: next.llmModel,
      i18n_llm_max_batch_size: next.llmMaxBatchSize,
      i18n_llm_max_attempts: next.llmMaxAttempts,
    });

    const updatedRow = db
      .prepare(
        `
        SELECT
          i18n_enabled,
          i18n_default_locale,
          i18n_supported_locales_csv,
          i18n_auto_translate,
          i18n_llm_enabled,
          i18n_llm_provider,
          i18n_llm_model,
          i18n_llm_max_batch_size,
          i18n_llm_max_attempts
        FROM system_config
        WHERE id = 1
      `,
      )
      .get() as any;

    const defaultLocale = String(updatedRow?.i18n_default_locale || DEFAULTS.defaultLocale);
    const supportedLocalesRaw = parseCsv(updatedRow?.i18n_supported_locales_csv);
    const supportedLocales2 = normalizeLocales(
      supportedLocalesRaw.length ? supportedLocalesRaw : DEFAULTS.supportedLocales,
      defaultLocale,
    );

    return {
      enabled: toBool(updatedRow?.i18n_enabled, DEFAULTS.enabled),
      defaultLocale,
      supportedLocales: supportedLocales2,
      autoTranslate: toBool(updatedRow?.i18n_auto_translate, DEFAULTS.autoTranslate),
      llmEnabled: toBool(updatedRow?.i18n_llm_enabled, DEFAULTS.llmEnabled),
      llmProvider: String(updatedRow?.i18n_llm_provider || DEFAULTS.llmProvider),
      llmModel: String(updatedRow?.i18n_llm_model || DEFAULTS.llmModel),
      llmMaxBatchSize: Math.max(1, Math.min(200, toInt(updatedRow?.i18n_llm_max_batch_size, DEFAULTS.llmMaxBatchSize))),
      llmMaxAttempts: Math.max(1, Math.min(10, toInt(updatedRow?.i18n_llm_max_attempts, DEFAULTS.llmMaxAttempts))),
    };
  });
}

export function getI18nPublicConfig() {
  const cfg = getI18nConfig();
  return { enabled: cfg.enabled, defaultLocale: cfg.defaultLocale, supportedLocales: cfg.supportedLocales };
}
