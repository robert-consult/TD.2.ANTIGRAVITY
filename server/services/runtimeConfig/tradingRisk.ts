import { getGlobalSettingsCached } from "../globalSettings";
import { storage } from "../../storage";
import {
  resolveEffectiveMinHoldSec,
  resolveEffectiveTradeLeverage,
  resolveTradeConcurrencyLimits,
  resolveTradingRiskConfig,
  type ResolvedTradeConcurrencyLimits,
  type ResolvedTradingRiskConfig,
  type TradingRiskSource,
  type TradingRiskUserOverridesSource,
} from "@shared/tradingRiskConfig";

export type { ResolvedTradeConcurrencyLimits, ResolvedTradingRiskConfig };
export {
  resolveEffectiveMinHoldSec,
  resolveEffectiveTradeLeverage,
  resolveTradeConcurrencyLimits,
  resolveTradingRiskConfig,
} from "@shared/tradingRiskConfig";

export async function getTradingRiskSnapshot(): Promise<ResolvedTradingRiskConfig> {
  const row = await getGlobalSettingsCached();
  return resolveTradingRiskConfig((row ?? null) as TradingRiskSource | null);
}

export function resolveUserTradeLimits(
  config: TradingRiskSource | ResolvedTradingRiskConfig | null | undefined,
  userOverrides?: TradingRiskUserOverridesSource | null,
): ResolvedTradeConcurrencyLimits {
  return resolveTradeConcurrencyLimits(config, userOverrides);
}

export async function getUserTradeLimits(
  userId: number,
  config?: TradingRiskSource | ResolvedTradingRiskConfig | null,
): Promise<ResolvedTradeConcurrencyLimits> {
  const [resolvedConfig, userSettings] = await Promise.all([
    config ? Promise.resolve(resolveTradingRiskConfig(config)) : getTradingRiskSnapshot(),
    storage.getUserSettingsById(userId),
  ]);
  return resolveTradeConcurrencyLimits(resolvedConfig, userSettings ?? null);
}

export async function getUserEffectiveMinHoldSec(
  userId: number,
  config?: TradingRiskSource | ResolvedTradingRiskConfig | null,
): Promise<number> {
  const limits = await getUserTradeLimits(userId, config);
  return limits.minHoldSec;
}
