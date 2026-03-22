import { getGlobalSettingsCached } from "../globalSettings";
import { globalSettings } from "@shared/schema";

type GlobalSettingsSource = Partial<typeof globalSettings.$inferSelect> | null | undefined;

export type ResolvedAutoClosePolicy = {
  enableAutoClose: boolean;
  autoCloseAfterDays: number;
  autoCloseCheckFrequencyMinutes: number;
};

export type AutoCloseDeployGuards = {
  staleDeferMaxMinutes: number;
  allowStaleClose: boolean;
};

export type EffectiveAutoCloseRuntime = {
  policy: ResolvedAutoClosePolicy;
  deployGuards: AutoCloseDeployGuards;
  source: "DB" | "DEFAULT";
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function resolveAutoClosePolicy(source: GlobalSettingsSource): ResolvedAutoClosePolicy {
  return {
    enableAutoClose: Boolean(source?.enableAutoClose ?? true),
    autoCloseAfterDays: clampInt(source?.autoCloseAfterDays, 4, 1, 365),
    autoCloseCheckFrequencyMinutes: clampInt(source?.autoCloseCheckFrequencyMinutes, 60, 1, 24 * 60),
  };
}

export function getAutoCloseDeployGuards(): AutoCloseDeployGuards {
  return {
    staleDeferMaxMinutes: clampInt(process.env.AUTOCLOSE_STALE_DEFER_MAX_MIN, 60, 1, 24 * 60),
    allowStaleClose: String(process.env.AUTOCLOSE_ALLOW_STALE_CLOSE ?? "false") === "true",
  };
}

export async function getAutoCloseRuntimeConfig(): Promise<EffectiveAutoCloseRuntime> {
  const row = await getGlobalSettingsCached();
  return {
    policy: resolveAutoClosePolicy(row ?? null),
    deployGuards: getAutoCloseDeployGuards(),
    source: row ? "DB" : "DEFAULT",
  };
}
