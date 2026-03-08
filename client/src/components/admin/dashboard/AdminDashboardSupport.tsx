import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import SignupFreezeWaitlistCard from "@/components/admin/SignupFreezeWaitlistCard";
import { JurisdictionControlsCard } from "@/components/admin/JurisdictionControlsCard";
import { MarketDataProvidersCard } from "@/components/admin/MarketDataProvidersCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  mergeGlobalSettingsPerformance,
  resolveGlobalPerformanceSettingsPayload,
} from "@/lib/globalSettingsPerformance";
import { PERFORMANCE_TIERS, flushIntervalForTier, pollIntervalForTier } from "@/lib/perfHints";

export function parseUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;

  let deviceType = 'Desktop';
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) {
    deviceType = /iPad|Tablet/i.test(ua) ? 'Tablet' : 'Mobile';
  }

  let browser = 'Unknown';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/MSIE|Trident/i.test(ua)) browser = 'IE';

  let os = 'Unknown';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';

  return `${deviceType} / ${browser} / ${os}`;
}

export interface UserSettings {
  userId: number;
  leverage: number;
  maxConcurrent: number;
  maxConcurrentPerInstrument?: number | null;
  maxConcurrentLots: number;
  minHoldSec: number;
  maxHoldSec: number;
  showOnLeaderboard: boolean;
  balance?: string;
}

export interface GlobalSettings {
  id: number;
  defaultLeverage: number;
  maxPositionSize: number;
  maxTradesPerUser: number;
  maxTradesPerInstrument: number;
  maxConcurrentLots: number;
  minPriceDistancePips: number;
  marketOpenTime: string;
  marketCloseTime: string;
  allowWeekendTrading: boolean;
  enableAutoClose: boolean;
  autoCloseAfterDays: number;
  autoCloseCheckFrequencyMinutes: number;
  minHoldSec: number;
  enableLossLimits: boolean;
  dailyLossLimitPct: number;
  lifetimeLossLimitPct: number;
  defaultUserStartingBalanceUsd: number;
  defaultUserStartingEquityUsd: number;
  defaultChallengeVirtualCapitalUsd: number;
  // Visual Lot Settings
  lotPresetCards: string; // JSON array string
  lotDropdownMax: number;
  // Client performance settings
  restFallbackPollMs: number;
  wsPushFrequencyMs: number;
  quoteFlushIntervalMs: number;
  maxWsReconnectAttempts: number;
  wsReconnectBaseDelayMs: number;
  prefetchStrategy: "all" | "critical" | "none";
  prefetchMaxConcurrency: number;
  prefetchStartDelayMs: number;
  prefetchFastConcurrencyCap: number;
  prefetchModerateConcurrencyCap: number;
  prefetchConstrainedConcurrencyCap: number;
  prefetchNetworkFastStartDelayMs: number;
  prefetchNetworkModerateStartDelayMs: number;
  prefetchNetworkConstrainedStartDelayMs: number;
  prefetchDeviceModerateStartDelayMs: number;
  prefetchDeviceConstrainedStartDelayMs: number;
  prefetchDeviceMinimalStartDelayMs: number;
  pollInstantMs: number;
  pollFastMs: number;
  pollModerateMs: number;
  pollConstrainedMs: number;
  pollMinimalMs: number;
  flushInstantMs: number;
  flushFastMs: number;
  flushModerateMs: number;
  flushConstrainedMs: number;
  flushMinimalMs: number;
  updatedAt: number | null;
}

export type MarketPerformanceSettings = Pick<
  GlobalSettings,
  "restFallbackPollMs" |
  "wsPushFrequencyMs" |
  "quoteFlushIntervalMs" |
  "maxWsReconnectAttempts" |
  "wsReconnectBaseDelayMs" |
  "prefetchStrategy" |
  "prefetchMaxConcurrency" |
  "prefetchStartDelayMs" |
  "prefetchFastConcurrencyCap" |
  "prefetchModerateConcurrencyCap" |
  "prefetchConstrainedConcurrencyCap" |
  "prefetchNetworkFastStartDelayMs" |
  "prefetchNetworkModerateStartDelayMs" |
  "prefetchNetworkConstrainedStartDelayMs" |
  "prefetchDeviceModerateStartDelayMs" |
  "prefetchDeviceConstrainedStartDelayMs" |
  "prefetchDeviceMinimalStartDelayMs" |
  "pollInstantMs" |
  "pollFastMs" |
  "pollModerateMs" |
  "pollConstrainedMs" |
  "pollMinimalMs" |
  "flushInstantMs" |
  "flushFastMs" |
  "flushModerateMs" |
  "flushConstrainedMs" |
  "flushMinimalMs"
>;

export const DEFAULT_MARKET_PERFORMANCE_SETTINGS: MarketPerformanceSettings = {
  restFallbackPollMs: 500,
  wsPushFrequencyMs: 0,
  quoteFlushIntervalMs: 50,
  maxWsReconnectAttempts: 30,
  wsReconnectBaseDelayMs: 1500,
  prefetchStrategy: "all",
  prefetchMaxConcurrency: 4,
  prefetchStartDelayMs: 0,
  prefetchFastConcurrencyCap: 3,
  prefetchModerateConcurrencyCap: 2,
  prefetchConstrainedConcurrencyCap: 1,
  prefetchNetworkFastStartDelayMs: 75,
  prefetchNetworkModerateStartDelayMs: 200,
  prefetchNetworkConstrainedStartDelayMs: 450,
  prefetchDeviceModerateStartDelayMs: 50,
  prefetchDeviceConstrainedStartDelayMs: 150,
  prefetchDeviceMinimalStartDelayMs: 300,
  pollInstantMs: 200,
  pollFastMs: 500,
  pollModerateMs: 1500,
  pollConstrainedMs: 4000,
  pollMinimalMs: 6000,
  flushInstantMs: 50,
  flushFastMs: 150,
  flushModerateMs: 300,
  flushConstrainedMs: 500,
  flushMinimalMs: 1000,
};

type MarketPerformanceNumericKey = Exclude<keyof MarketPerformanceSettings, "prefetchStrategy">;
type PerformanceTierKey = (typeof PERFORMANCE_TIERS)[number];

export const TIER_POLL_SETTING_KEYS: Record<PerformanceTierKey, MarketPerformanceNumericKey> = {
  INSTANT: "pollInstantMs",
  FAST: "pollFastMs",
  MODERATE: "pollModerateMs",
  CONSTRAINED: "pollConstrainedMs",
  MINIMAL: "pollMinimalMs",
};

export const TIER_FLUSH_SETTING_KEYS: Record<PerformanceTierKey, MarketPerformanceNumericKey> = {
  INSTANT: "flushInstantMs",
  FAST: "flushFastMs",
  MODERATE: "flushModerateMs",
  CONSTRAINED: "flushConstrainedMs",
  MINIMAL: "flushMinimalMs",
};

const clampIntSetting = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

export function resolveMarketPerformanceSettings(candidate: Partial<GlobalSettings> | null | undefined): MarketPerformanceSettings {
  const source = resolveGlobalPerformanceSettingsPayload(candidate);
  const restFallbackPollMs = clampIntSetting(source.restFallbackPollMs, 100, 60_000, 500);
  const quoteFlushIntervalMs = clampIntSetting(source.quoteFlushIntervalMs, 20, 5_000, 50);
  const prefetchRaw = String(source.prefetchStrategy ?? "all").trim().toLowerCase();
  const prefetchStrategy = prefetchRaw === "critical" || prefetchRaw === "none" ? prefetchRaw : "all";

  return {
    restFallbackPollMs,
    wsPushFrequencyMs: clampIntSetting(source.wsPushFrequencyMs, 0, 1_000, 0),
    quoteFlushIntervalMs,
    maxWsReconnectAttempts: clampIntSetting(source.maxWsReconnectAttempts, 1, 30, 30),
    wsReconnectBaseDelayMs: clampIntSetting(source.wsReconnectBaseDelayMs, 100, 30_000, 1500),
    prefetchStrategy: prefetchStrategy as MarketPerformanceSettings["prefetchStrategy"],
    prefetchMaxConcurrency: clampIntSetting(source.prefetchMaxConcurrency, 1, 6, 4),
    prefetchStartDelayMs: clampIntSetting(source.prefetchStartDelayMs, 0, 15_000, 0),
    prefetchFastConcurrencyCap: clampIntSetting(source.prefetchFastConcurrencyCap, 1, 6, 3),
    prefetchModerateConcurrencyCap: clampIntSetting(source.prefetchModerateConcurrencyCap, 1, 6, 2),
    prefetchConstrainedConcurrencyCap: clampIntSetting(source.prefetchConstrainedConcurrencyCap, 1, 6, 1),
    prefetchNetworkFastStartDelayMs: clampIntSetting(source.prefetchNetworkFastStartDelayMs, 0, 15_000, 75),
    prefetchNetworkModerateStartDelayMs: clampIntSetting(
      source.prefetchNetworkModerateStartDelayMs,
      0,
      15_000,
      200,
    ),
    prefetchNetworkConstrainedStartDelayMs: clampIntSetting(
      source.prefetchNetworkConstrainedStartDelayMs,
      0,
      15_000,
      450,
    ),
    prefetchDeviceModerateStartDelayMs: clampIntSetting(
      source.prefetchDeviceModerateStartDelayMs,
      0,
      15_000,
      50,
    ),
    prefetchDeviceConstrainedStartDelayMs: clampIntSetting(
      source.prefetchDeviceConstrainedStartDelayMs,
      0,
      15_000,
      150,
    ),
    prefetchDeviceMinimalStartDelayMs: clampIntSetting(source.prefetchDeviceMinimalStartDelayMs, 0, 15_000, 300),
    pollInstantMs: clampIntSetting(
      source.pollInstantMs,
      100,
      60_000,
      pollIntervalForTier("INSTANT", restFallbackPollMs),
    ),
    pollFastMs: clampIntSetting(
      source.pollFastMs,
      100,
      60_000,
      pollIntervalForTier("FAST", restFallbackPollMs),
    ),
    pollModerateMs: clampIntSetting(
      source.pollModerateMs,
      100,
      60_000,
      pollIntervalForTier("MODERATE", restFallbackPollMs),
    ),
    pollConstrainedMs: clampIntSetting(
      source.pollConstrainedMs,
      100,
      60_000,
      pollIntervalForTier("CONSTRAINED", restFallbackPollMs),
    ),
    pollMinimalMs: clampIntSetting(
      source.pollMinimalMs,
      100,
      60_000,
      pollIntervalForTier("MINIMAL", restFallbackPollMs),
    ),
    flushInstantMs: clampIntSetting(
      source.flushInstantMs,
      20,
      5_000,
      flushIntervalForTier("INSTANT", quoteFlushIntervalMs),
    ),
    flushFastMs: clampIntSetting(
      source.flushFastMs,
      20,
      5_000,
      flushIntervalForTier("FAST", quoteFlushIntervalMs),
    ),
    flushModerateMs: clampIntSetting(
      source.flushModerateMs,
      20,
      5_000,
      flushIntervalForTier("MODERATE", quoteFlushIntervalMs),
    ),
    flushConstrainedMs: clampIntSetting(
      source.flushConstrainedMs,
      20,
      5_000,
      flushIntervalForTier("CONSTRAINED", quoteFlushIntervalMs),
    ),
    flushMinimalMs: clampIntSetting(
      source.flushMinimalMs,
      20,
      5_000,
      flushIntervalForTier("MINIMAL", quoteFlushIntervalMs),
    ),
  };
}

const MARKET_PERFORMANCE_SETTING_KEYS: readonly (keyof MarketPerformanceSettings)[] = [
  "restFallbackPollMs",
  "wsPushFrequencyMs",
  "quoteFlushIntervalMs",
  "maxWsReconnectAttempts",
  "wsReconnectBaseDelayMs",
  "prefetchStrategy",
  "prefetchMaxConcurrency",
  "prefetchStartDelayMs",
  "prefetchFastConcurrencyCap",
  "prefetchModerateConcurrencyCap",
  "prefetchConstrainedConcurrencyCap",
  "prefetchNetworkFastStartDelayMs",
  "prefetchNetworkModerateStartDelayMs",
  "prefetchNetworkConstrainedStartDelayMs",
  "prefetchDeviceModerateStartDelayMs",
  "prefetchDeviceConstrainedStartDelayMs",
  "prefetchDeviceMinimalStartDelayMs",
  "pollInstantMs",
  "pollFastMs",
  "pollModerateMs",
  "pollConstrainedMs",
  "pollMinimalMs",
  "flushInstantMs",
  "flushFastMs",
  "flushModerateMs",
  "flushConstrainedMs",
  "flushMinimalMs",
] as const;

export function marketPerformanceSettingsEqual(a: MarketPerformanceSettings, b: MarketPerformanceSettings): boolean {
  for (const key of MARKET_PERFORMANCE_SETTING_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export const MARKET_PERFORMANCE_FIELD_HELP: Record<
  keyof MarketPerformanceSettings,
  { inline: string; tooltip: string }
> = {
  restFallbackPollMs: {
    inline: "Fallback request interval when live WebSocket push is unavailable.",
    tooltip:
      "Phone + internet context: lower values keep prices fresher but use more mobile data/battery. Use higher values for weaker 4G/3G or older phones.",
  },
  wsPushFrequencyMs: {
    inline: "Server-side push cadence for quote fanout (0 = immediate push).",
    tooltip:
      "Phone + internet context: 0 gives lowest latency on strong Wi-Fi/5G. Increasing this value batches updates to reduce network load on constrained links.",
  },
  quoteFlushIntervalMs: {
    inline: "How often buffered quote updates are flushed to connected clients.",
    tooltip:
      "Phone + internet context: lower values feel real-time but increase traffic. Higher values smooth bursts for slower devices and unstable networks.",
  },
  maxWsReconnectAttempts: {
    inline: "How many times clients retry reconnecting after a stream drop.",
    tooltip:
      "Phone + internet context: higher retry counts help users on spotty cellular coverage recover without manual refresh.",
  },
  wsReconnectBaseDelayMs: {
    inline: "Initial wait before retrying WS reconnect (uses backoff on each retry).",
    tooltip:
      "Phone + internet context: higher delay reduces reconnect storms on poor networks; lower delay restores streaming faster on reliable links.",
  },
  prefetchStrategy: {
    inline: "Initial data warm-up amount sent after app load or reconnect.",
    tooltip:
      "Phone + internet context: choose less prefetch for low-bandwidth users, or full prefetch for stronger devices/networks that need instant context.",
  },
  prefetchMaxConcurrency: {
    inline: "Maximum concurrent chunk fetches during prefetch burst (tier safety caps still apply).",
    tooltip:
      "Higher values warm more routes in parallel, but tier-aware caps limit pressure on weaker links so startup REST/WS remains responsive.",
  },
  prefetchStartDelayMs: {
    inline: "Minimum delay before route prefetch starts after shell mount.",
    tooltip:
      "Tier baselines already add small safety delays on weaker links/devices. Increase this value to enforce additional global startup headroom.",
  },
  prefetchFastConcurrencyCap: {
    inline: "FAST network cap for concurrent prefetch requests.",
    tooltip:
      "Upper bound applied on FAST links before device caps. Lower values protect startup WS/API headroom.",
  },
  prefetchModerateConcurrencyCap: {
    inline: "MODERATE network cap for concurrent prefetch requests.",
    tooltip:
      "Use lower values to avoid request contention on mixed 4G links while still warming core routes.",
  },
  prefetchConstrainedConcurrencyCap: {
    inline: "CONSTRAINED network cap for concurrent prefetch requests.",
    tooltip:
      "For weak links, keep this low to prevent prefetch traffic from delaying live quote connect/reconnect.",
  },
  prefetchNetworkFastStartDelayMs: {
    inline: "FAST network delay floor before prefetch starts.",
    tooltip:
      "Minimum delay applied on FAST links (combined with global/base and device floors via max()).",
  },
  prefetchNetworkModerateStartDelayMs: {
    inline: "MODERATE network delay floor before prefetch starts.",
    tooltip:
      "Minimum delay applied on MODERATE links to leave headroom for initial auth/settings/WS traffic.",
  },
  prefetchNetworkConstrainedStartDelayMs: {
    inline: "CONSTRAINED network delay floor before prefetch starts.",
    tooltip:
      "Minimum delay applied on constrained links where startup bandwidth is limited and reconnect is sensitive.",
  },
  prefetchDeviceModerateStartDelayMs: {
    inline: "MODERATE device delay floor before prefetch starts.",
    tooltip:
      "Minimum delay floor for mid-tier devices; helps avoid CPU/network contention during first paint.",
  },
  prefetchDeviceConstrainedStartDelayMs: {
    inline: "CONSTRAINED device delay floor before prefetch starts.",
    tooltip:
      "Minimum delay floor for constrained devices where parse/boot cost is higher.",
  },
  prefetchDeviceMinimalStartDelayMs: {
    inline: "MINIMAL device delay floor before prefetch starts.",
    tooltip:
      "Minimum delay floor for the most constrained devices (prefetch still disabled when network tier is MINIMAL).",
  },
  pollInstantMs: {
    inline: "Poll interval for INSTANT profile.",
    tooltip:
      "INSTANT profile targets newer phones on strong Wi-Fi/5G. Lower poll intervals provide freshest fallback quotes with higher data usage.",
  },
  pollFastMs: {
    inline: "Poll interval for FAST profile.",
    tooltip:
      "FAST profile fits most modern phones on stable 4G/5G. Balance latency against mobile data and battery use.",
  },
  pollModerateMs: {
    inline: "Poll interval for MODERATE profile.",
    tooltip:
      "MODERATE profile fits mixed hardware and variable signal quality. Raise values to reduce network/battery pressure.",
  },
  pollConstrainedMs: {
    inline: "Poll interval for CONSTRAINED profile.",
    tooltip:
      "CONSTRAINED profile targets weak 4G/3G conditions. Higher values prioritize stability and lower bandwidth usage.",
  },
  pollMinimalMs: {
    inline: "Poll interval for MINIMAL profile.",
    tooltip:
      "MINIMAL profile is for very limited connectivity or aggressive data-saving mode. Highest values minimize traffic at the cost of freshness.",
  },
  flushInstantMs: {
    inline: "Flush interval for INSTANT profile.",
    tooltip:
      "INSTANT flush should stay low for high-end phones on strong internet where lowest latency is expected.",
  },
  flushFastMs: {
    inline: "Flush interval for FAST profile.",
    tooltip:
      "FAST flush is tuned for everyday 4G/5G. Increase to reduce traffic bursts when users report unstable connections.",
  },
  flushModerateMs: {
    inline: "Flush interval for MODERATE profile.",
    tooltip:
      "MODERATE flush helps balance timely UI updates against bandwidth for average mobile conditions.",
  },
  flushConstrainedMs: {
    inline: "Flush interval for CONSTRAINED profile.",
    tooltip:
      "CONSTRAINED flush should be conservative for weak links to avoid reconnect churn and packet loss pressure.",
  },
  flushMinimalMs: {
    inline: "Flush interval for MINIMAL profile.",
    tooltip:
      "MINIMAL flush is for the slowest/least reliable conditions. Higher values favor reliability and battery life.",
  },
};

export const MARKET_PERFORMANCE_TIER_HELP: Record<PerformanceTierKey, string> = {
  INSTANT: "Newest phones on strong Wi-Fi/5G.",
  FAST: "Typical modern phones on good 4G/5G.",
  MODERATE: "Mixed phones or variable coverage.",
  CONSTRAINED: "Weak 4G/3G or congested mobile data.",
  MINIMAL: "Very slow/unstable networks or strict data-saving mode.",
};

export const TRADE_SETTINGS_FIELD_HELP = {
  defaultUserStartingBalanceUsd:
    "Used when creating a new user account. Existing users keep their current balances unless you run a separate balance update.",
  defaultUserStartingEquityUsd:
    "Initial equity baseline for new users. For most setups, keep this aligned with starting balance unless you intentionally model a different opening equity.",
  defaultChallengeVirtualCapitalUsd:
    "Default virtual capital for newly created challenge drafts. Existing/active challenges are not retroactively changed.",
  marketOpenTime:
    "Daily UTC start time for allowing new trade opens. Choose UTC values that match your intended market window across timezones.",
  marketCloseTime:
    "Daily UTC cutoff for allowing new trade opens. Set this with opening time to define the allowed opening window.",
  allowWeekendTrading:
    "Controls whether new opens are allowed on Saturday/Sunday (UTC). Disable to enforce weekday-only opens.",
  defaultLeverage:
    "Default leverage for accounts without user-specific overrides. Higher leverage increases risk exposure and margin sensitivity.",
  maxPositionSize:
    "Hard ceiling on a single position size. Orders above this value are rejected by server-side risk controls.",
  maxTradesPerUser:
    "Maximum concurrent open trades permitted per user across all instruments.",
  maxTradesPerInstrument:
    "Maximum concurrent open trades permitted for the same instrument (per user).",
  maxConcurrentLots:
    "Total lots cap across all open trades for one user. Prevents aggregate overexposure even if single-trade limits pass.",
  minPriceDistancePips:
    "Minimum allowed distance (in pips) for pending orders and TP/SL levels. Raising this reduces tight-order churn and micro-noise triggers.",
  enableAutoClose:
    "Global switch for automatic age-based closing. Turn off to disable auto-close processing without changing stored thresholds.",
  autoCloseAfterDays:
    "Open-trade age threshold before a trade becomes eligible for auto-close (when auto-close is enabled).",
  autoCloseCheckFrequencyMinutes:
    "How often the auto-close worker scans for eligible trades. Lower values enforce sooner but increase background processing frequency.",
  minHoldSec:
    "Minimum seconds a trade must remain open before manual close is allowed (unless a stricter user override exists).",
  enableLossLimits:
    "Global switch for daily/lifetime loss guardrails. Turn off only if you intentionally want those controls bypassed platform-wide.",
  dailyLossLimitPct:
    "Daily maximum loss threshold as a percent of initial balance. Enter whole percent values (example: 10 = 10%).",
  lifetimeLossLimitPct:
    "Lifetime maximum loss threshold as a percent of initial balance. Enter whole percent values (example: 20 = 20%).",
  lotPresetCards:
    "Quick-select lot buttons shown in trader order forms. Keep presets simple and ascending so users can choose size quickly and safely.",
  lotDropdownMax:
    "Upper lot value shown in the lot dropdown. Also acts as the cap for preset card values (max 50).",
} as const;

export const MARKET_DATA_QUOTE_FIELD_HELP = {
  quoteRefreshMs: {
    inline: "How often clients request quote updates when fallback polling is active.",
    tooltip:
      "Lower values improve UI freshness but increase request volume and battery/network use. Raise for constrained networks/devices.",
  },
  feedPollMs: {
    inline: "How often the server ingestor polls upstream providers for fresh prices.",
    tooltip:
      "Lower values reduce upstream latency but increase provider/API load and rate-limit pressure. Keep aligned with provider limits.",
  },
  staleThresholdMs: {
    inline: "Age limit after which cached quotes are marked stale.",
    tooltip:
      "If too low, quotes may be flagged stale during brief feed jitter. If too high, stale prices may linger longer before protections activate.",
  },
} as const;

export const MARKET_PERFORMANCE_TIER_TABLE_HELP = {
  tier:
    "Phone + network profile bucket assigned to clients. Use stricter tiers for slower devices and weaker links.",
  tierPollMs:
    "Fallback polling interval for each tier. Lower = fresher prices, higher network/battery usage.",
  tierFlushMs:
    "Buffered push flush interval for each tier. Lower = faster update feel, higher = less burst traffic.",
} as const;

export const TRADING_CONTROLS_FIELD_HELP = {
  maintenanceMode: {
    inline: "Show a maintenance state and block non-admin trading actions.",
    tooltip:
      "Use for planned maintenance windows. Existing sessions stay online, but trading actions are gated for non-admin users.",
  },
  tradingHalt: {
    inline: "Emergency kill switch that blocks all new opens globally.",
    tooltip:
      "Use only for incident response. This fails closed for new trade opens platform-wide and should be rolled back deliberately.",
  },
  closeOnlyMode: {
    inline: "Allow only close actions; no new positions can be opened.",
    tooltip:
      "Useful for controlled risk wind-downs. Users can reduce exposure, but cannot create additional open risk.",
  },
  blockOpenOnStaleQuotes: {
    inline: "Reject open orders when quote freshness checks fail.",
    tooltip:
      "Prevents opening on stale pricing snapshots. Keep enabled unless you intentionally accept stale-price execution risk.",
  },
  maintenanceMessage: {
    inline: "User-facing message shown when maintenance mode is active.",
    tooltip:
      "Keep this concise and action-oriented. Include what users should do next, but avoid exposing sensitive incident details.",
  },
} as const;

export const FX_ROLLOVER_FIELD_HELP = {
  fxRolloverTz: {
    inline: "Time zone used to interpret the daily FX rollover boundary.",
    tooltip:
      "Choose an IANA timezone aligned with your operations policy. This affects daily close boundaries and rollover-dependent calculations.",
  },
  fxRolloverTime: {
    inline: "Daily rollover cutoff time in the selected timezone.",
    tooltip:
      "Use 24-hour HH:MM format. Values set too near volatile market windows can produce confusing day-boundary behavior.",
  },
} as const;

export const SYSTEM_I18N_FIELD_HELP = {
  enabled: {
    inline: "Master switch for localization behavior across web/mobile surfaces.",
    tooltip:
      "When disabled, clients should default to base language behavior. Keep enabled unless localization must be paused globally.",
  },
  autoTranslate: {
    inline: "Automatically generate translations for missing keys.",
    tooltip:
      "Convenient for coverage, but generated strings still need review for legal and compliance-sensitive copy.",
  },
  llmEnabled: {
    inline: "Enable background translation worker for AI-assisted localization.",
    tooltip:
      "Disable if provider credentials are unavailable or if translation generation should be frozen for release control.",
  },
  defaultLocale: {
    inline: "Fallback locale used when user/device locale is unavailable.",
    tooltip:
      "Use a valid locale tag like en or en-US. This locale should always be included in Supported Locales.",
  },
  supportedLocales: {
    inline: "Locales clients are allowed to request (comma-separated).",
    tooltip:
      "Use normalized locale tags and include default locale. Unsupported locales will fall back to default.",
  },
  llmProvider: {
    inline: "Translation provider identifier used by the worker.",
    tooltip:
      "Must match server-supported provider keys and configured credentials. Mismatch can cause translation jobs to fail silently.",
  },
  llmModel: {
    inline: "Model name used for translation generation requests.",
    tooltip:
      "Pick a model that balances cost, latency, and quality. Changing this affects throughput and translation consistency.",
  },
  llmMaxBatchSize: {
    inline: "Maximum keys processed per translation batch.",
    tooltip:
      "Higher values improve throughput but increase request payload size and retry blast radius on failure.",
  },
  llmMaxAttempts: {
    inline: "Retry attempts per failed translation batch.",
    tooltip:
      "Higher retries improve eventual success but can increase queue delay and provider usage during incidents.",
  },
} as const;

export const CONTROLS_FIELD_HELP = {
  allowUserTimezoneEdit: {
    inline: "Allow end users to change their profile timezone.",
    tooltip:
      "Disabling keeps timezone locked to admin/system defaults. Useful when jurisdiction or reporting consistency is required.",
  },
  rememberMeEnabled: {
    inline: "Global enable/disable for persistent login tokens.",
    tooltip:
      "Acts as a platform-wide kill switch for remember-me sessions. Disable during credential/security incidents.",
  },
  rememberMeMaxAgeDays: {
    inline: "Maximum lifetime for remember-me tokens.",
    tooltip:
      "Longer windows improve convenience but increase token exposure period. Keep aligned with security policy.",
  },
  rememberMeMaxDevicesPerUser: {
    inline: "Maximum remembered devices allowed per account.",
    tooltip:
      "Lower values reduce account surface area; higher values support more user devices but increase management complexity.",
  },
  rememberMeReauthAfterAbsenceDays: {
    inline: "Force reauthentication after long inactivity.",
    tooltip:
      "Use to balance convenience with dormant-session risk. Set to 0 to disable absence-based forced reauth.",
  },
  sessionCookieMaxAgeHours: {
    inline: "Hard expiry for active authenticated session cookies.",
    tooltip:
      "Short values tighten security; long values reduce login interruptions. Keep aligned with enterprise session policy.",
  },
  sessionIdleTimeoutMinutes: {
    inline: "Idle time before active session expires.",
    tooltip:
      "Set to 0 to disable idle timeout. Lower values reduce unattended-session risk but can disrupt users.",
  },
  rememberMeTokenRotationEnabled: {
    inline: "Rotate remember tokens after use to prevent replay.",
    tooltip:
      "Recommended on. Rotation limits token replay windows and improves theft detection confidence.",
  },
  rememberMeTheftAutoRevokeAll: {
    inline: "Revoke all sessions/devices when token theft is detected.",
    tooltip:
      "Strong containment control for compromise events. Users may be logged out across all devices when triggered.",
  },
  logoutClearAllDeviceTokens: {
    inline: "Clear all remembered device tokens on explicit logout.",
    tooltip:
      "More secure for shared devices and incident response, but reduces convenience for users with multiple trusted devices.",
  },
  scoutTabEnabled: {
    inline: "Control visibility of the Scout admin workspace tab.",
    tooltip:
      "UI-level access control for Scout navigation. Disable when Scout features are not in active operational use.",
  },
} as const;

export const MIGRATION_FIELD_HELP = {
  chunkingEnabled: {
    inline: "Split exports/imports into multiple parts for large dataset reliability.",
    tooltip:
      "Enable for large migrations or unstable links. Chunking reduces retry blast radius when one file transfer fails.",
  },
  chunkSizeGb: {
    inline: "Target chunk size in GB for generated export parts.",
    tooltip:
      "Smaller chunks improve resumability and error isolation; larger chunks reduce file count but increase retry cost.",
  },
  exportScope: {
    inline: "Choose full, single-user, or delta export mode.",
    tooltip:
      "Use FULL_PLATFORM for complete backups, USER_BUNDLE for targeted user migration, and DELTA for incremental transfers.",
  },
  exportUserId: {
    inline: "User ID to export when scope is Single trader bundle.",
    tooltip:
      "Must be a valid numeric user ID. Export fails if the selected account does not exist or is inaccessible.",
  },
  exportSince: {
    inline: "Start timestamp for DELTA export window.",
    tooltip:
      "Only changes at or after this timestamp are exported. Confirm timezone/local clock to avoid missing data.",
  },
  importMode: {
    inline: "Run import as dry-run validation or write mode.",
    tooltip:
      "Use DRY_RUN first to validate manifest/data integrity and constraints before any write operation.",
  },
  importManifestFile: {
    inline: "Manifest JSON describing dataset metadata and chunk list.",
    tooltip:
      "Manifest drives file validation and expected parts. A malformed manifest will block import creation.",
  },
  importDataFiles: {
    inline: "Upload NDJSON data file(s) matching manifest expectations.",
    tooltip:
      "For chunked imports, all expected parts must be present with exact filenames; missing/extra parts will fail validation.",
  },
  purgeDays: {
    inline: "Retention threshold for export file cleanup.",
    tooltip:
      "Purges export artifacts older than this value from server storage. Metadata records remain for audit visibility.",
  },
  importPurgeDays: {
    inline: "Retention threshold for uploaded import artifact cleanup.",
    tooltip:
      "Purges uploaded manifest/data files older than this value. Use to control disk usage after migration operations.",
  },
} as const;

export const SYSTEM_HEALTH_FIELD_HELP = {
  provider: {
    inline: "Provider to inspect and probe for live readiness.",
    tooltip:
      "Selecting a provider scopes health checks and probe actions. Use this to compare active vs standby provider status.",
  },
  refresh: {
    inline: "Manually refresh health snapshot from server.",
    tooltip:
      "Use when validating recent config changes or incident recovery. The view also auto-refreshes on a short interval.",
  },
  fetchStatus: {
    inline: "Run provider probe against selected provider.",
    tooltip:
      "Performs a direct status/probe call for the chosen provider. Useful for key/permission/connectivity diagnostics.",
  },
} as const;

export function FieldHintLabel({
  label,
  hint,
  labelClassName = "text-sm",
}: {
  label: string;
  hint: string;
  labelClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className={labelClassName}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
            aria-label={`${label} hint`}
          >
            Hint
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
          {hint}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export const SIGNUP_COMPLIANCE_FIELD_HELP = {
  signupCaptchaEnforce: {
    inline: "Require a bot/human verification challenge during account creation.",
    tooltip:
      "When enabled, signup must pass the configured CAPTCHA provider before account creation can proceed.",
  },
  captchaProvider: {
    inline: "Provider used for signup challenge verification.",
    tooltip:
      "Switch providers only after keys and server integration are confirmed. Mismatched provider config can block all signups.",
  },
  signupPhoneEnforce: {
    inline: "Require phone number capture during registration.",
    tooltip:
      "When enabled, signup cannot complete without a valid phone value. Disable only if your compliance policy allows email-only onboarding.",
  },
  legalCoverageEnforce: {
    inline: "Block signup when legal/jurisdiction coverage is missing or restricted.",
    tooltip:
      "Use this fail-closed gate to prevent onboarding where legal coverage requirements are not satisfied.",
  },
} as const;

export const INSTRUMENTS_FIELD_HELP = {
  configuredOverview: {
    inline: "Control which instruments are tradable and how symbol-level risk/format settings are applied.",
    tooltip:
      "Use this surface to manage the active instrument universe. Symbol settings directly affect pricing display, order validation, and lot constraints.",
  },
  addFromCatalog: {
    inline: "Promote vetted rows from reference catalog into live tradable symbols.",
    tooltip:
      "Best for bulk enablement from provider catalog. Validate category, decimals, and lot bounds before enabling large batches.",
  },
  addNewInstrument: {
    inline: "Create a brand-new symbol directly in live configuration.",
    tooltip:
      "Use for custom/internal symbols or urgent additions not yet in reference catalog. Verify symbol identity and lot guardrails before saving.",
  },
  editAction: {
    inline: "Adjust decimals, spread floor, lot bounds, and enabled state for an existing symbol.",
    tooltip:
      "Editing takes effect immediately for new trade attempts and quote formatting. Coordinate high-impact changes with trading/risk operations.",
  },
  removeAction: {
    inline: "Disable future trading on a symbol by removing it from live availability.",
    tooltip:
      "Removal does not rewrite historical trades. Use when delisting or suspending instruments and confirm downstream UX expectations.",
  },
  symbol: {
    inline: "Canonical symbol identifier used across quotes, orders, and subscriptions.",
    tooltip:
      "Prefer standardized market symbols to avoid duplicate identities (for example, EURUSD vs EUR/USD). Keep symbol naming stable once live.",
  },
  displayName: {
    inline: "Human-readable instrument name shown in trader-facing UIs.",
    tooltip:
      "Use a clear label that matches market convention. Inconsistent naming can confuse search and subscription workflows.",
  },
  category: {
    inline: "Asset class grouping used by defaults and formatting behavior.",
    tooltip:
      "Category drives ingestion defaults (pip/quote decimals) and can influence filtering in admin/trader surfaces.",
  },
  minSpreadPips: {
    inline: "Minimum spread floor applied to this instrument in pips.",
    tooltip:
      "Higher values increase spread protection; lower values tighten execution feel. Keep aligned with liquidity and risk policy.",
  },
  baseCurrency: {
    inline: "Primary/base currency leg for the instrument pair or contract.",
    tooltip:
      "Used for display and downstream analytics. Keep this normalized to ISO-like currency/asset codes where applicable.",
  },
  quoteCurrency: {
    inline: "Quote/settlement currency leg for the instrument pair or contract.",
    tooltip:
      "Used for display and quote interpretation. Ensure this matches provider conventions to avoid user confusion.",
  },
  pipDecimals: {
    inline: "Pip precision exponent (pip size = 10^-pipDecimals).",
    tooltip:
      "Controls pip-size math used in spread/pnl presentation. Incorrect values can distort pips, risk checks, and trader expectations.",
  },
  quoteDecimals: {
    inline: "Display rounding precision for quote rendering.",
    tooltip:
      "Higher precision shows finer price increments; lower precision reduces visual noise. Keep in sync with market convention per symbol.",
  },
  minLot: {
    inline: "Smallest tradable lot size for this instrument.",
    tooltip:
      "Lower mins allow smaller position sizing; ensure it is compatible with risk and margin assumptions.",
  },
  maxLot: {
    inline: "Largest tradable lot size for this instrument.",
    tooltip:
      "Upper bound protects against oversized single-order exposure. Coordinate with global/user caps to avoid contradictory limits.",
  },
  enabled: {
    inline: "Master availability switch for opening new trades on this symbol.",
    tooltip:
      "When disabled, new opens should be blocked while historical and existing trade records remain intact.",
  },
} as const;

export const VIEW_AS_TRADER_FIELD_HELP = {
  overview: {
    inline: "Launch a read-through trader session for support and troubleshooting scenarios.",
    tooltip:
      "Use this to reproduce user-side behavior without requesting credentials. Every impersonation start is audit logged and should follow support/compliance policy.",
  },
  searchFilter: {
    inline: "Filter non-admin traders by name, email, username, or phone before selecting a target account.",
    tooltip:
      "Use precise search terms to avoid impersonating the wrong account. Confirm identity fields before launching a session.",
  },
  viewAsAction: {
    inline: "Starts an impersonated trader session for the selected account.",
    tooltip:
      "Action takes effect immediately and should be used for diagnostics only. Always verify status and intended user before clicking.",
  },
} as const;

export const USER_MANAGEMENT_FIELD_HELP = {
  overview: {
    inline: "Manage trader account state, KYC progression, login/audit trails, and user-level operational controls.",
    tooltip:
      "User Management combines account operations, compliance workflows, and forensic trails. Use mini-tabs to scope your task and avoid acting on the wrong cohort.",
  },
  exportCsv: {
    inline: "Export current user dataset to CSV for spreadsheet workflows.",
    tooltip:
      "CSV export is best for manual review and lightweight reporting. Confirm your current scope before exporting sensitive user data.",
  },
  exportJsonl: {
    inline: "Export users as JSONL for machine processing and pipeline ingestion.",
    tooltip:
      "JSONL export preserves structured fields for downstream tooling. Use for audit pipelines and scripted analysis instead of spreadsheet workflows.",
  },
  exportParquet: {
    inline: "Export users as columnar Parquet for large-scale analytics and warehouse ingestion.",
    tooltip:
      "Parquet is preferred for very large datasets due to compression and columnar scanning efficiency.",
  },
  miniTabs: {
    inline: "Switch between live account cohorts, trails, KYC pipeline, activity controls, and grift detection.",
    tooltip:
      "Each mini-tab targets a different operational surface. Validate the active tab before making account-impacting changes.",
  },
  tabAll: {
    inline: "All users, regardless of account state.",
    tooltip:
      "Shows the full user population including active, frozen, and disabled states.",
  },
  tabActive: {
    inline: "Users currently active (not frozen or disabled).",
    tooltip:
      "Use this to review accounts currently eligible for normal trading access.",
  },
  tabDisabled: {
    inline: "Users currently disabled from platform usage.",
    tooltip:
      "Disabled accounts cannot operate normally. Re-enable only after verification and audit review.",
  },
  tabFrozen: {
    inline: "Users temporarily frozen for risk/compliance reasons.",
    tooltip:
      "Frozen users remain visible for investigation. Unfreeze only when hold conditions are cleared.",
  },
  tabOnline: {
    inline: "Live session visibility for currently online and offline users.",
    tooltip:
      "Use this for real-time session diagnostics and support triage. Session timing and IP data can be operationally sensitive.",
  },
  tabLogins: {
    inline: "Historical login attempts with success/failure outcomes.",
    tooltip:
      "Use Login History for credential abuse review, support troubleshooting, and incident response sequencing.",
  },
  tabAudit: {
    inline: "Combined timeline of signups, logins, and admin interventions.",
    tooltip:
      "Audit timeline is cross-domain context for what happened, when, and from where. Use event filters to reduce noise before decisions.",
  },
  tabKyc: {
    inline: "KYC contender pipeline, policy thresholds, and queue actions.",
    tooltip:
      "KYC tab controls who enters review and how invite/rejection decisions are handled. Policy edits change future candidate eligibility.",
  },
  tabGrift: {
    inline: "Fraud/grift analytics and investigation workflows.",
    tooltip:
      "Grift Detection contains multi-signal risk monitoring and enforcement controls. Use it for coordinated account-risk investigations.",
  },
  tabActivity: {
    inline: "Inactivity and bot-based deletion queue controls.",
    tooltip:
      "Activity tab manages dormant account lifecycle and anti-bot deletion workflows.",
  },
  bulkActions: {
    inline: "Apply account status changes to selected visible users.",
    tooltip:
      "Bulk actions are high-impact. Validate selected rows and tab scope before applying status changes.",
  },
  disableSelectedAction: {
    inline: "Disable all selected accounts in one operation.",
    tooltip:
      "Bulk disable prevents account access for selected users. Confirm this aligns with policy and support intent.",
  },
  enableSelectedAction: {
    inline: "Re-enable selected disabled accounts.",
    tooltip:
      "Bulk enable restores account access for selected users. Ensure remediation and approval prerequisites are met.",
  },
  clearSelectionAction: {
    inline: "Clear current selected row set.",
    tooltip:
      "Use clear selection before changing filters/tabs to prevent accidental bulk actions.",
  },
  onlineOverview: {
    inline: "Live view of active sessions with login timestamp and session duration.",
    tooltip:
      "Online view helps diagnose current session behavior. Validate time interpretation and timezone context during support handling.",
  },
  loginTrailOverview: {
    inline: "Historical login trail with IP, device agent, and failure reasons.",
    tooltip:
      "Use login trail to inspect account access attempts. Failed patterns can indicate credential stuffing or device anomalies.",
  },
  auditOverview: {
    inline: "Unified event timeline for signup, login, and admin actions.",
    tooltip:
      "Audit view merges lifecycle events into one chronology. Event-type filters improve incident triage and root-cause analysis.",
  },
  auditEventFilter: {
    inline: "Limit timeline to specific event types.",
    tooltip:
      "Filtering reduces noise in busy timelines. Use narrow filters first, then expand to full context when needed.",
  },
  kycOverview: {
    inline: "Configure contender qualification policy and act on queued KYC candidates.",
    tooltip:
      "KYC controls determine who qualifies for review and how messaging/verification throttles apply. Changes affect future queue formation.",
  },
  kycPath1MinAgeDays: {
    inline: "Minimum account age for Path 1 eligibility.",
    tooltip:
      "Path 1 age gate requires the account to exist for at least this many days before contender status can be assigned.",
  },
  kycPath1MinTradesLifetime: {
    inline: "Minimum lifetime trade count for Path 1.",
    tooltip:
      "Higher values require longer demonstrated activity before KYC contender promotion.",
  },
  kycPath1MinBalancePct: {
    inline: "Minimum balance multiple over starting capital for Path 1.",
    tooltip:
      "Example: 1.20 means 120% of starting balance. Lower values widen eligibility; higher values tighten performance requirements.",
  },
  kycPath2MinAgeDays: {
    inline: "Minimum account age for Path 2 eligibility.",
    tooltip:
      "Path 2 still enforces account maturity before recent-performance checks are considered.",
  },
  kycPath2MinTradesLast90: {
    inline: "Minimum recent trade count in the rolling Path 2 window.",
    tooltip:
      "Ensures contender status is based on active recent behavior, not stale historical trades.",
  },
  kycPath2MinReturnLast90: {
    inline: "Minimum recent return multiple in the rolling Path 2 window.",
    tooltip:
      "Example: 0.10 means +10% over the window baseline. Tune conservatively to avoid noisy candidate spikes.",
  },
  kycPath2MaxDaysSinceLastTrade: {
    inline: "Maximum allowed days since the user’s last trade for Path 2.",
    tooltip:
      "Prevents dormant accounts from qualifying via stale historical performance alone.",
  },
  kycEmailResendCooldownSec: {
    inline: "Minimum seconds between email resend attempts.",
    tooltip:
      "Cooldown throttles repeated email sends and reduces abuse risk in invite/verification flows.",
  },
  kycEmailDailySendCap: {
    inline: "Max email sends per user per day for this workflow.",
    tooltip:
      "Daily cap limits repeated message attempts and protects sender reputation.",
  },
  kycSmsResendCooldownSec: {
    inline: "Minimum seconds between SMS resend attempts.",
    tooltip:
      "Cooldown reduces OTP spam risk and telecom cost spikes from repeated resend taps.",
  },
  kycSmsDailySendCap: {
    inline: "Max SMS sends per user per day for this workflow.",
    tooltip:
      "Daily cap controls spend and abuse while preserving legitimate retry capacity.",
  },
  kycOtpMaxAttempts: {
    inline: "Maximum allowed OTP entry attempts before lock.",
    tooltip:
      "Lower values increase brute-force resistance but can raise support friction. Tune with recovery policy in mind.",
  },
  kycOtpLockMinutes: {
    inline: "Lock duration after OTP attempt exhaustion.",
    tooltip:
      "Defines how long users must wait after hitting attempt limits before retrying verification.",
  },
  kycAutoPromotePerformer: {
    inline: "Automatically promote eligible users to PERFORMER tier.",
    tooltip:
      "When enabled, qualifying users are promoted without manual intervention. Keep this aligned with compliance review posture.",
  },
  kycSaveControls: {
    inline: "Persist updated KYC policy controls.",
    tooltip:
      "Saving applies new thresholds to future queue evaluation and messaging constraints.",
  },
  kycInviteAction: {
    inline: "Send KYC invitation to selected candidate.",
    tooltip:
      "Invite action starts the candidate’s KYC submission workflow and should follow eligibility verification.",
  },
  kycRejectAction: {
    inline: "Reject candidate from current queue cycle.",
    tooltip:
      "Reject action marks candidate as rejected for this review path. Use only after policy/ops review.",
  },
  columnsPicker: {
    inline: "Show/hide list columns for focused account operations.",
    tooltip:
      "Column visibility only affects current admin view. Hide nonessential columns to reduce decision noise.",
  },
  selectAllVisible: {
    inline: "Select all currently filtered/visible users.",
    tooltip:
      "Select-all applies to the current filtered set, not the entire database. Re-check filters before bulk actions.",
  },
  nameFilter: {
    inline: "Filter by display name.",
    tooltip:
      "Use partial text matching to narrow user rows by display name.",
  },
  phoneFilter: {
    inline: "Filter by phone number.",
    tooltip:
      "Useful for support cases where phone is the primary user identifier.",
  },
  usernameFilter: {
    inline: "Filter by username handle.",
    tooltip:
      "Use exact or partial username fragments to isolate account rows.",
  },
  emailFilter: {
    inline: "Filter by user email address.",
    tooltip:
      "Email filter is typically the fastest route to a specific user record.",
  },
  balanceEditor: {
    inline: "Directly edit user balance and commit on Enter/blur.",
    tooltip:
      "Balance edits apply immediately when committed. Validate amount precision and intended account before changing.",
  },
  leaderboardVisibility: {
    inline: "Toggle user visibility on leaderboard surfaces.",
    tooltip:
      "Disabling hides the user from leaderboard views while preserving account and trade records.",
  },
  rowActions: {
    inline: "Open user edit, timeline, notes, and account-state controls.",
    tooltip:
      "Actions are state-aware (enable/disable/freeze/unfreeze). Confirm status badge before taking action.",
  },
  editAction: {
    inline: "Open user settings editor.",
    tooltip:
      "Use Edit to modify per-user risk and profile-adjacent admin settings.",
  },
  timelineAction: {
    inline: "Open user activity timeline.",
    tooltip:
      "Timeline view helps reconstruct account events before administrative decisions.",
  },
  notesAction: {
    inline: "Open internal notes for this user.",
    tooltip:
      "Use notes for case context and operator handoff details.",
  },
  freezeAction: {
    inline: "Temporarily freeze account operations.",
    tooltip:
      "Freeze is typically used for investigation hold scenarios. Unfreeze when risk/compliance clearance is complete.",
  },
  unfreezeAction: {
    inline: "Release frozen account back to active state.",
    tooltip:
      "Unfreeze restores normal operation for non-disabled accounts.",
  },
  disableAction: {
    inline: "Disable account access.",
    tooltip:
      "Disable is a stronger state than freeze and typically requires formal justification.",
  },
  enableAction: {
    inline: "Re-enable previously disabled account.",
    tooltip:
      "Enable restores access; verify remediation and approval artifacts before use.",
  },
} as const;

export function parseLocaleCsvInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of String(raw || "").split(",")) {
    const locale = token.trim();
    if (!locale) continue;
    const key = locale.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(locale);
  }
  return out;
}

export function resolveI18nAdminConfig(candidate: Partial<I18nAdminConfigData> | null | undefined): I18nAdminConfigData {
  const defaultLocale = String(candidate?.defaultLocale || "en").trim() || "en";
  const supportedRaw = Array.isArray(candidate?.supportedLocales) ? candidate.supportedLocales.map(String) : [defaultLocale];
  const supportedLocales = parseLocaleCsvInput(supportedRaw.join(","));
  if (!supportedLocales.find((locale) => locale.toLowerCase() === defaultLocale.toLowerCase())) {
    supportedLocales.unshift(defaultLocale);
  }

  return {
    enabled: Boolean(candidate?.enabled ?? true),
    defaultLocale,
    supportedLocales,
    autoTranslate: Boolean(candidate?.autoTranslate ?? true),
    llmEnabled: Boolean(candidate?.llmEnabled ?? true),
    llmProvider: String(candidate?.llmProvider || "openai"),
    llmModel: String(candidate?.llmModel || "gpt-4o-mini"),
    llmMaxBatchSize: Math.max(1, Math.min(200, Math.trunc(Number(candidate?.llmMaxBatchSize ?? 50) || 50))),
    llmMaxAttempts: Math.max(1, Math.min(10, Math.trunc(Number(candidate?.llmMaxAttempts ?? 3) || 3))),
  };
}

export interface User {
  id: number;
  email: string;
  username: string;
  name?: string | null;
  phone?: string | null;
  balance: string;
  isAdmin: boolean;
  isDisabled?: boolean;
  isFrozen?: boolean;
  freezeReasonCode?: string | null;
  freezeReasonText?: string | null;
  frozenAt?: number | null;
  createdAt?: number;
  leverage?: number;
  maxConcurrent?: number;
  maxConcurrentPerInstrument?: number | null;
  maxConcurrentLots?: number;
  minHoldSec?: number;
  maxHoldSec?: number;
  showOnLeaderboard?: boolean;
}

export type UserColumnKey = 'name' | 'phone' | 'username' | 'email' | 'status' | 'balance' | 'leverage' | 'maxTrades' | 'minHold' | 'maxHold' | 'leaderboard';

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: number | Date;
  severity: string;
  reasonCode?: string;
  reasonText?: string;
  metadata?: any;
  loginTime?: number | Date;
  logoutTime?: number | Date;
  sessionLengthSec?: number;
  loginIp?: string;
}

export interface AdminNote {
  id: number;
  userId: number;
  adminId: number | null;
  type: 'NOTE' | 'FLAG';
  severity: 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
  flagCode?: string;
  content: string;
  isResolved: boolean;
  resolvedAt?: number;
  createdAt: number;
}

export interface SymbolConfig {
  id: number;
  symbol: string;
  name: string;
  category?: string | null;
  baseCurrency?: string;
  quoteCurrency?: string;
  spread?: number;
  minSpreadPips: number;
  pipDecimals?: number | null;
  quoteDecimals?: number | null;
  enabled: boolean;
  minLot: number;
  maxLot: number;
  createdAt?: number;
}

export interface SystemConfigData {
  id: number;
  maintenanceMode: boolean;
  tradingHalt: boolean;
  closeOnlyMode: boolean;
  blockOpenOnStaleQuotes: boolean;
  maintenanceMessage: string;
  quoteRefreshMs: number;
  feedPollMs: number;
  staleThresholdMs: number;
  fxRolloverTz: string;
  fxRolloverTime: string;
  signupCaptchaEnforce: boolean;
  captchaProvider: string;
  signupPhoneEnforce: boolean;
  legalCoverageEnforce: boolean;
  jurisdictionRestrictedIso2Csv: string;
  jurisdictionRestrictedMessage: string;
  jurisdictionEnforceByIpGeo: boolean;
  jurisdictionEnforceBySignupCountry: boolean;
  jurisdictionBlockSignup: boolean;
  jurisdictionBlockLogin: boolean;
  allowUserTimezoneEdit: boolean;
  scoutTabEnabled: boolean;
  // Signup freeze + invite waitlist
  signupFreeze: boolean;
  signupFreezeMessage: string;
  signupWaitlistEnabled: boolean;
  signupWaitlistInviteSender: string;
  signupWaitlistInviteSubject: string;
  signupWaitlistInviteBodyText: string;
  signupWaitlistAutoInviteOnUnfreeze: boolean;
  signupWaitlistInviteBatchCap: number;
  signupWaitlistPolicyVersion: string;
  signupWaitlistPolicyContent: string;
  rememberMeEnabled: boolean;
  rememberMeMaxAgeDays: number;
  rememberMeMaxDevicesPerUser: number;
  rememberMeReauthAfterAbsenceDays: number;
  rememberMeTokenRotationEnabled: boolean;
  rememberMeTheftAutoRevokeAll: boolean;
  sessionCookieMaxAgeHours: number;
  sessionIdleTimeoutMinutes: number;
  logoutClearAllDeviceTokens: boolean;
  // Migration export/import chunking
  migrationChunkingEnabled: boolean;
  migrationChunkSizeMb: number;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface I18nAdminConfigData {
  enabled: boolean;
  defaultLocale: string;
  supportedLocales: string[];
  autoTranslate: boolean;
  llmEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  llmMaxBatchSize: number;
  llmMaxAttempts: number;
}

export type SystemConfigSaveSection =
  | "trading"
  | "marketData"
  | "signupCompliance"
  | "signupFreezeWaitlist"
  | "jurisdiction"
  | "sessionAndAccess";

export type TradeSettingsSaveSection = "capital" | "marketHours" | "defaultRisk" | "operationalRiskAndLot";

export interface MigrationExportJob {
  id: string;
  scope: string;
  userId?: number | null;
  sinceTs?: number | null;
  status: string;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  totals?: Record<string, number> | null;
  manifest?: any;
  dataPartsJson?: string | null;
  chunkingEnabled?: boolean | null;
  chunkSizeMb?: number | null;
  manifestSha256?: string | null;
  dataSha256?: string | null;
  dataPath?: string | null;
  manifestPath?: string | null;
  error?: string | null;
}

export interface MigrationImportJob {
  id: string;
  mode: string;
  idStrategy?: string;
  status: string;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  totals?: Record<string, number> | null;
  manifestSha256?: string | null;
  dataSha256?: string | null;
  dataPartsJson?: string | null;
  dataPath?: string | null;
  manifestPath?: string | null;
  error?: string | null;
}

export interface PolicyConfigData {
  policyContenderPath1MinAgeDays: number;
  policyContenderPath1MinTradesLifetime: number;
  policyContenderPath1MinBalancePct: number;
  policyContenderPath2MinAgeDays: number;
  policyContenderPath2MinTradesLast90: number;
  policyContenderPath2MinReturnLast90: number;
  policyContenderPath2MaxDaysSinceLastTrade: number;
  policyAutoPromotePerformer: boolean;
  policyEmailResendCooldownSec: number;
  policyEmailDailySendCap: number;
  policySmsDailySendCap: number;
  policySmsResendCooldownSec: number;
  policyOtpMaxAttempts: number;
  policyOtpLockMinutes: number;
  updatedAt?: number | null;
}

export interface KycCandidate {
  userId: number;
  email: string;
  username: string;
  accountAgeDays: number;
  tradesLifetime: number;
  tradesLast90d: number;
  balancePctOfStart: number;
  returnLast90d: number;
  contenderPath1: boolean;
  contenderPath2: boolean;
  userTier: string;
  contenderTier: string;
  selectedAt: string | null;
}

export interface SystemHealthData {
  apiConnected: boolean;
  lastSuccess: string | null;
  failures: number;
  staleCount: number;
  cacheSize: number;
  serverTime: string;
  feedSource?: string | null;
  feedSourceAt?: string | null;
  feedProviderKey?: string | null;
  feedProviderDriver?: string | null;
  feedProviderDisplayName?: string | null;
  feedProviderConnected?: boolean;
  lastProviderSuccessAt?: string | null;
  lastProviderSuccessKey?: string | null;
  activeProviderKey?: string | null;
  requestedProviderKey?: string | null;
  requestedProvider?: {
    providerKey: string;
    displayName: string | null;
    driver: string | null;
    configUsable: boolean;
    missingSecrets: string[];
    isActiveConfigured: boolean;
    error?: string;
  } | null;
}

export interface MarketDataProvidersResp {
  ok: boolean;
  activeKey: string | null;
  rows: Array<{ providerKey: string; displayName: string; driver: string; isEnabled: boolean; deletedAt: number | null }>;
}

export interface LoginHistoryEntry {
  id: number;
  userId: number;
  email?: string;
  username?: string;
  ipAddress: string | null;
  ip?: string | null;
  ip_address?: string | null;
  userAgent: string | null;
  user_agent?: string | null;
  success: boolean;
  failureReason: string | null;
  createdAt: number;
}

interface TimezoneRow {
  name: string;
  label: string;
  countryCode: string;
  group: string;
  currentTimeOffsetInMinutes: number;
  currentOffsetMinutes: number;
  abbreviation: string;
  rawFormat: string;
}

export function FxRolloverSettings({
  config,
  setConfig,
  setConfigChanged
}: {
  config: SystemConfigData;
  setConfig: (fn: (prev: SystemConfigData | null) => SystemConfigData | null) => void;
  setConfigChanged: (v: boolean) => void;
}) {
  const { data: timezonesData } = useQuery<{ rows: TimezoneRow[] }>({
    queryKey: ["/api/meta/timezones"],
    queryFn: () => axios.get("/api/meta/timezones").then(r => r.data),
  });

  const timezoneRows = useMemo(() => {
    return timezonesData?.rows ?? [];
  }, [timezonesData?.rows]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <FieldHintLabel label="FX Rollover Time Zone" hint={FX_ROLLOVER_FIELD_HELP.fxRolloverTz.tooltip} labelClassName="text-base font-medium" />
        <p className="text-xs text-gray-400 mt-1">{FX_ROLLOVER_FIELD_HELP.fxRolloverTz.inline}</p>
        <Select
          value={config.fxRolloverTz}
          onValueChange={(value) => {
            setConfig(prev => prev ? { ...prev, fxRolloverTz: value } : prev);
            setConfigChanged(true);
          }}
        >
          <SelectTrigger className="bg-neutral-600 mt-2" title={FX_ROLLOVER_FIELD_HELP.fxRolloverTz.tooltip}>
            <SelectValue placeholder="Select timezone" />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            {timezoneRows.length > 0 ? (
              timezoneRows.map((tz) => (
                <SelectItem key={tz.name} value={tz.name}>
                  {tz.label}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <div>
        <FieldHintLabel label="FX Rollover Time" hint={FX_ROLLOVER_FIELD_HELP.fxRolloverTime.tooltip} labelClassName="text-base font-medium" />
        <p className="text-xs text-gray-400 mt-1">{FX_ROLLOVER_FIELD_HELP.fxRolloverTime.inline}</p>
        <Input
          type="time"
          value={config.fxRolloverTime}
          onChange={(e) => {
            setConfig(prev => prev ? { ...prev, fxRolloverTime: e.target.value } : prev);
            setConfigChanged(true);
          }}
          className="bg-neutral-600 mt-2"
          title={FX_ROLLOVER_FIELD_HELP.fxRolloverTime.tooltip}
        />
      </div>
    </div>
  );
}
