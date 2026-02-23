import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo, useRef } from "react";

function parseUserAgent(ua: string | null | undefined): string | null {
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
import axios from "axios";
import SymbolSelect from "../components/SymbolSelect";
import AdminData from "@/pages/AdminData";
import AdminTradeAudit from "@/pages/AdminTradeAudit";
import AdminCommunications from "@/pages/AdminCommunications";
import GriftAdmin, { KycQueueTab } from "@/components/admin/GriftAdmin";
import UserActivityAdmin from "@/components/admin/UserActivityAdmin";
import { AdminLegalPanel } from "@/components/admin/AdminLegalTabs";
import SignupFreezeWaitlistCard from "@/components/admin/SignupFreezeWaitlistCard";
import { JurisdictionControlsCard } from "@/components/admin/JurisdictionControlsCard";
import { MarketDataProvidersCard } from "@/components/admin/MarketDataProvidersCard";
import { InstrumentIngestionPanel } from "@/components/admin/InstrumentIngestionPanel";
import { InstrumentCatalogEnableDialog } from "@/components/admin/InstrumentCatalogEnableDialog";
import { PipDefaultsPanel } from "@/components/admin/PipDefaultsPanel";
import { QuoteSubscriptionsPanel } from "@/components/admin/QuoteSubscriptionsPanel";
import ScoutWorkbench from "@/components/admin/ScoutWorkbench";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  mergeGlobalSettingsPerformance,
  resolveGlobalPerformanceSettingsPayload,
} from "@/lib/globalSettingsPerformance";
import { PERFORMANCE_TIERS, flushIntervalForTier, pollIntervalForTier } from "@/lib/perfHints";

interface UserSettings {
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

interface GlobalSettings {
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

type MarketPerformanceSettings = Pick<
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

const DEFAULT_MARKET_PERFORMANCE_SETTINGS: MarketPerformanceSettings = {
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

const TIER_POLL_SETTING_KEYS: Record<PerformanceTierKey, MarketPerformanceNumericKey> = {
  INSTANT: "pollInstantMs",
  FAST: "pollFastMs",
  MODERATE: "pollModerateMs",
  CONSTRAINED: "pollConstrainedMs",
  MINIMAL: "pollMinimalMs",
};

const TIER_FLUSH_SETTING_KEYS: Record<PerformanceTierKey, MarketPerformanceNumericKey> = {
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

function resolveMarketPerformanceSettings(candidate: Partial<GlobalSettings> | null | undefined): MarketPerformanceSettings {
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

function marketPerformanceSettingsEqual(a: MarketPerformanceSettings, b: MarketPerformanceSettings): boolean {
  for (const key of MARKET_PERFORMANCE_SETTING_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

const MARKET_PERFORMANCE_FIELD_HELP: Record<
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

const MARKET_PERFORMANCE_TIER_HELP: Record<PerformanceTierKey, string> = {
  INSTANT: "Newest phones on strong Wi-Fi/5G.",
  FAST: "Typical modern phones on good 4G/5G.",
  MODERATE: "Mixed phones or variable coverage.",
  CONSTRAINED: "Weak 4G/3G or congested mobile data.",
  MINIMAL: "Very slow/unstable networks or strict data-saving mode.",
};

const TRADE_SETTINGS_FIELD_HELP = {
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

const MARKET_DATA_QUOTE_FIELD_HELP = {
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

const MARKET_PERFORMANCE_TIER_TABLE_HELP = {
  tier:
    "Phone + network profile bucket assigned to clients. Use stricter tiers for slower devices and weaker links.",
  tierPollMs:
    "Fallback polling interval for each tier. Lower = fresher prices, higher network/battery usage.",
  tierFlushMs:
    "Buffered push flush interval for each tier. Lower = faster update feel, higher = less burst traffic.",
} as const;

const TRADING_CONTROLS_FIELD_HELP = {
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

const FX_ROLLOVER_FIELD_HELP = {
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

const SYSTEM_I18N_FIELD_HELP = {
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

const CONTROLS_FIELD_HELP = {
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

const MIGRATION_FIELD_HELP = {
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

const SYSTEM_HEALTH_FIELD_HELP = {
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

function FieldHintLabel({
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

const SIGNUP_COMPLIANCE_FIELD_HELP = {
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

const INSTRUMENTS_FIELD_HELP = {
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

const VIEW_AS_TRADER_FIELD_HELP = {
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

const USER_MANAGEMENT_FIELD_HELP = {
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

function parseLocaleCsvInput(raw: string): string[] {
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

function resolveI18nAdminConfig(candidate: Partial<I18nAdminConfigData> | null | undefined): I18nAdminConfigData {
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

interface User {
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

type UserColumnKey = 'name' | 'phone' | 'username' | 'email' | 'status' | 'balance' | 'leverage' | 'maxTrades' | 'minHold' | 'maxHold' | 'leaderboard';

interface TimelineEvent {
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

interface AdminNote {
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

interface SymbolConfig {
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

interface SystemConfigData {
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

interface I18nAdminConfigData {
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

interface MigrationExportJob {
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

interface MigrationImportJob {
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

interface PolicyConfigData {
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

interface KycCandidate {
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

interface SystemHealthData {
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

interface MarketDataProvidersResp {
  ok: boolean;
  activeKey: string | null;
  rows: Array<{ providerKey: string; displayName: string; driver: string; isEnabled: boolean; deletedAt: number | null }>;
}

interface LoginHistoryEntry {
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

function FxRolloverSettings({
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

function MigrationTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ===== Migration chunking settings (stored in system_config) =====
  const systemConfigQuery = useQuery<SystemConfigData>({
    queryKey: ["/api/admin/system-config"],
    queryFn: () => axios.get("/api/admin/system-config").then((r) => r.data),
  });

  const [chunkingEnabledDraft, setChunkingEnabledDraft] = useState<boolean>(false);
  const [chunkSizeGbDraft, setChunkSizeGbDraft] = useState<string>("50");
  const [chunkSettingsDirty, setChunkSettingsDirty] = useState(false);

  useEffect(() => {
    const cfg = systemConfigQuery.data;
    if (!cfg) return;
    if (!chunkSettingsDirty) {
      setChunkingEnabledDraft(Boolean(cfg.migrationChunkingEnabled));
      const mb = Number(cfg.migrationChunkSizeMb ?? 51200);
      const gb = mb / 1024;
      const gbStr = Number.isFinite(gb) ? String(Math.round(gb * 100) / 100) : "50";
      setChunkSizeGbDraft(gbStr);
    }
  }, [systemConfigQuery.data, chunkSettingsDirty]);

  const saveChunkSettingsMutation = useMutation({
    mutationFn: async (payload: { migrationChunkingEnabled: boolean; migrationChunkSizeMb: number }) => {
      return axios.put("/api/admin/system-config", payload).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-config"] });
      setChunkSettingsDirty(false);
      toast({ title: "Migration settings saved", description: "Chunking settings updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error.response?.data?.message || "Failed to save migration settings",
        variant: "destructive",
      });
    },
  });

  const humanBytes = (n?: number | null) => {
    const v = Number(n ?? 0);
    if (!Number.isFinite(v) || v <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let x = v;
    while (x >= 1024 && i < units.length - 1) {
      x /= 1024;
      i++;
    }
    const rounded = i === 0 ? String(Math.round(x)) : String(Math.round(x * 100) / 100);
    return `${rounded} ${units[i]}`;
  };

  const chunkingSummary = useMemo(() => {
    const enabled = chunkingEnabledDraft;
    const gb = Number(chunkSizeGbDraft);
    const mb = Math.floor((Number.isFinite(gb) ? gb : 50) * 1024);
    if (!enabled) return "Chunking: Disabled (single file)";
    return `Chunking: Enabled (${Number.isFinite(gb) ? gb : 50} GB approx ${mb} MB)`;
  }, [chunkingEnabledDraft, chunkSizeGbDraft]);

  const handleSaveChunkSettings = () => {
    const gb = Number(chunkSizeGbDraft);
    if (chunkingEnabledDraft) {
      if (!Number.isFinite(gb) || gb <= 0) {
        toast({ title: "Invalid chunk size", description: "Enter a positive size in GB", variant: "destructive" });
        return;
      }
    }

    const mb = Math.floor((Number.isFinite(gb) && gb > 0 ? gb : 50) * 1024);
    saveChunkSettingsMutation.mutate({
      migrationChunkingEnabled: Boolean(chunkingEnabledDraft),
      migrationChunkSizeMb: chunkingEnabledDraft ? Math.max(256, mb) : mb,
    });
  };

  const downloadTextFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getScriptContext = (job: MigrationExportJob) => {
    const manifest = job.manifest;
    if (!manifest || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) return null;
    const chunks = [...manifest.chunks].sort((a: any, b: any) => Number(a?.index ?? 0) - Number(b?.index ?? 0));
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const headLinkHash = String(manifest?.chunkChain?.headLinkHash || "");
    const dataSha256 = String(manifest?.dataSha256 || "");
    return { base, jobId: job.id, chunks, headLinkHash, dataSha256 };
  };

  const buildDownloadVerifyScript = (ctx: {
    base: string;
    jobId: string;
    chunks: any[];
    headLinkHash: string;
    dataSha256: string;
  }) => {
    const files = ctx.chunks.map((c: any) => `"${String(c?.file || "")}"`).join(" ");
    const shas = ctx.chunks.map((c: any) => `"${String(c?.sha256 || "")}"`).join(" ");
    const indexes = ctx.chunks.map((c: any) => String(c?.index ?? 0)).join(" ");
    const base = ctx.base.replace(/"/g, '\\"');
    const jobId = ctx.jobId.replace(/"/g, '\\"');

    return `#!/usr/bin/env bash
set -euo pipefail

BASE="\${BASE:-${base}}"
JOB="\${JOB:-${jobId}}"
OUT_DIR="\${OUT_DIR:-./export_\${JOB}}"
CONCURRENCY="\${CONCURRENCY:-10}"
if ! [[ "\$CONCURRENCY" =~ ^[0-9]+$ ]]; then CONCURRENCY=10; fi
if [ "\$CONCURRENCY" -gt 10 ]; then CONCURRENCY=10; fi
if [ "\$CONCURRENCY" -lt 1 ]; then CONCURRENCY=1; fi
echo "Parallelism: \${CONCURRENCY} (hard max 10)"

mkdir -p "\$OUT_DIR"
curl -f -L -o "\$OUT_DIR/\${JOB}-manifest.json" "\$BASE/api/admin/migration/export-jobs/\${JOB}/manifest"

INDEXES=(${indexes})
FILES=(${files})
SHAS=(${shas})
HEAD_LINK_HASH="${ctx.headLinkHash}"
DATA_SHA256="${ctx.dataSha256}"

download_one() {
  local idx="$1"
  local file="$2"
  local url="\$BASE/api/admin/migration/export-jobs/\$JOB/chunks/\$idx"
  curl -f -L -C - -o "\$OUT_DIR/\$file" "\$url"
}

pids=()
for i in "\${!INDEXES[@]}"; do
  download_one "\${INDEXES[\$i]}" "\${FILES[\$i]}" &
  pids+=($!)
  if [ \${#pids[@]} -ge "\$CONCURRENCY" ]; then
    wait "\${pids[0]}"
    pids=("\${pids[@]:1}")
  fi
done
for pid in "\${pids[@]}"; do wait "\$pid"; done

for i in "\${!FILES[@]}"; do
  file="\${FILES[\$i]}"
  expected="\${SHAS[\$i]}"
  actual=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  if [ "\$actual" != "\$expected" ]; then
    echo "SHA mismatch: \$file"
    exit 1
  fi
done

prev="GENESIS"
for i in "\${!FILES[@]}"; do
  file="\${FILES[\$i]}"
  sha=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  prev=$(printf "%s:%s" "\$prev" "\$sha" | sha256sum | awk '{print \$1}')
done

if [ -n "\$HEAD_LINK_HASH" ] && [ "\$prev" != "\$HEAD_LINK_HASH" ]; then
  echo "Chain head mismatch: expected \$HEAD_LINK_HASH got \$prev"
  exit 1
fi

if [ -n "\$DATA_SHA256" ]; then
  data=$(cat "\${FILES[@]/#/\$OUT_DIR/}" | sha256sum | awk '{print \$1}')
  if [ "\$data" != "\$DATA_SHA256" ]; then
    echo "Data SHA mismatch: expected \$DATA_SHA256 got \$data"
    exit 1
  fi
fi

echo "OK: all chunks verified"
`;
  };

  const buildMissingScript = (ctx: {
    base: string;
    jobId: string;
    chunks: any[];
    headLinkHash: string;
    dataSha256: string;
  }) => {
    const files = ctx.chunks.map((c: any) => `"${String(c?.file || "")}"`).join(" ");
    const shas = ctx.chunks.map((c: any) => `"${String(c?.sha256 || "")}"`).join(" ");
    const indexes = ctx.chunks.map((c: any) => String(c?.index ?? 0)).join(" ");
    const base = ctx.base.replace(/"/g, '\\"');
    const jobId = ctx.jobId.replace(/"/g, '\\"');

    return `#!/usr/bin/env bash
set -euo pipefail

BASE="\${BASE:-${base}}"
JOB="\${JOB:-${jobId}}"
OUT_DIR="\${OUT_DIR:-./export_\${JOB}}"
CONCURRENCY="\${CONCURRENCY:-10}"
if ! [[ "\$CONCURRENCY" =~ ^[0-9]+$ ]]; then CONCURRENCY=10; fi
if [ "\$CONCURRENCY" -gt 10 ]; then CONCURRENCY=10; fi
if [ "\$CONCURRENCY" -lt 1 ]; then CONCURRENCY=1; fi
echo "Parallelism: \${CONCURRENCY} (hard max 10)"

mkdir -p "\$OUT_DIR"
curl -f -L -o "\$OUT_DIR/\${JOB}-manifest.json" "\$BASE/api/admin/migration/export-jobs/\${JOB}/manifest"

INDEXES=(${indexes})
FILES=(${files})
SHAS=(${shas})
HEAD_LINK_HASH="${ctx.headLinkHash}"
DATA_SHA256="${ctx.dataSha256}"

download_one() {
  local idx="$1"
  local file="$2"
  local url="\$BASE/api/admin/migration/export-jobs/\$JOB/chunks/\$idx"
  curl -f -L -C - -o "\$OUT_DIR/\$file" "\$url"
}

needs_download() {
  local file="$1"
  local expected="$2"
  if [ ! -f "\$OUT_DIR/\$file" ]; then return 0; fi
  local actual
  actual=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  if [ "\$actual" != "\$expected" ]; then return 0; fi
  return 1
}

pids=()
for i in "\${!INDEXES[@]}"; do
  file="\${FILES[\$i]}"
  expected="\${SHAS[\$i]}"
  if needs_download "\$file" "\$expected"; then
    download_one "\${INDEXES[\$i]}" "\$file" &
    pids+=($!)
    if [ \${#pids[@]} -ge "\$CONCURRENCY" ]; then
      wait "\${pids[0]}"
      pids=("\${pids[@]:1}")
    fi
  fi
done
for pid in "\${pids[@]}"; do wait "\$pid"; done

for i in "\${!FILES[@]}"; do
  file="\${FILES[\$i]}"
  expected="\${SHAS[\$i]}"
  actual=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  if [ "\$actual" != "\$expected" ]; then
    echo "SHA mismatch: \$file"
    exit 1
  fi
done

prev="GENESIS"
for i in "\${!FILES[@]}"; do
  file="\${FILES[\$i]}"
  sha=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  prev=$(printf "%s:%s" "\$prev" "\$sha" | sha256sum | awk '{print \$1}')
done

if [ -n "\$HEAD_LINK_HASH" ] && [ "\$prev" != "\$HEAD_LINK_HASH" ]; then
  echo "Chain head mismatch: expected \$HEAD_LINK_HASH got \$prev"
  exit 1
fi

if [ -n "\$DATA_SHA256" ]; then
  data=$(cat "\${FILES[@]/#/\$OUT_DIR/}" | sha256sum | awk '{print \$1}')
  if [ "\$data" != "\$DATA_SHA256" ]; then
    echo "Data SHA mismatch: expected \$DATA_SHA256 got \$data"
    exit 1
  fi
fi

echo "OK: chunks verified"
`;
  };

  const buildImportScript = (ctx: { base: string; jobId: string; chunks: any[] }) => {
    const files = ctx.chunks
      .map((c: any) => `-F "data=@$OUT_DIR/${String(c?.file || "")}"`)
      .join(" \\\n  ");
    const base = ctx.base.replace(/"/g, '\\"');
    const jobId = ctx.jobId.replace(/"/g, '\\"');

    return `#!/usr/bin/env bash
set -euo pipefail

BASE="\${BASE:-${base}}"
JOB="\${JOB:-${jobId}}"
OUT_DIR="\${OUT_DIR:-./export_\${JOB}}"
MANIFEST="\${MANIFEST:-\${JOB}-manifest.json}"
MODE="\${MODE:-DRY_RUN}"

echo "NOTE: requires admin auth (session cookie or header)."

curl -f -L -X POST "\$BASE/api/admin/migration/import-jobs" \\
  -F "manifest=@$OUT_DIR/$MANIFEST" \\
  ${files} \\
  -F "mode=$MODE" \\
  -F "idStrategy=PRESERVE"
`;
  };

  // ===== Export form =====
  const [exportScope, setExportScope] = useState("FULL_PLATFORM");
  const [exportUserId, setExportUserId] = useState("");
  const [exportSince, setExportSince] = useState("");

  // ===== Import form (supports chunked imports) =====
  const [importMode, setImportMode] = useState("DRY_RUN");
  const [importManifestFile, setImportManifestFile] = useState<File | null>(null);
  const [importDataFiles, setImportDataFiles] = useState<File[]>([]);
  const [importManifestMeta, setImportManifestMeta] = useState<{
    chunked: boolean;
    chunkCount: number;
    expectedFiles: string[];
  } | null>(null);

  const [purgeDays, setPurgeDays] = useState("30");
  const [importPurgeDays, setImportPurgeDays] = useState("30");

  const exportJobsQuery = useQuery<MigrationExportJob[]>({
    queryKey: ["/api/admin/migration/export-jobs"],
    queryFn: () => axios.get("/api/admin/migration/export-jobs").then((r) => r.data),
    refetchInterval: 5000,
  });

  const importJobsQuery = useQuery<MigrationImportJob[]>({
    queryKey: ["/api/admin/migration/import-jobs"],
    queryFn: () => axios.get("/api/admin/migration/import-jobs").then((r) => r.data),
    refetchInterval: 5000,
  });

  const exportMutation = useMutation({
    mutationFn: (payload: any) => axios.post("/api/admin/migration/export-jobs", payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/export-jobs"] });
      toast({ title: "Export job created", description: "Job queued for processing" });
    },
    onError: (error: any) => {
      toast({
        title: "Export failed",
        description: error.response?.data?.message || "Failed to create export job",
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: (form: FormData) =>
      axios.post("/api/admin/migration/import-jobs", form, { headers: { "Content-Type": "multipart/form-data" } })
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/import-jobs"] });
      toast({ title: "Import job created", description: "Job queued for processing" });
      setImportManifestFile(null);
      setImportDataFiles([]);
      setImportManifestMeta(null);
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error.response?.data?.message || "Failed to create import job",
        variant: "destructive",
      });
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (payload: { olderThanDays: number }) =>
      axios.post("/api/admin/migration/export-jobs/purge", payload).then((r) => r.data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/export-jobs"] });
      toast({
        title: "Exports purged",
        description: `Jobs: ${data?.jobsPurged ?? 0} | Files: ${data?.filesRemoved ?? 0}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.response?.data?.message || "Failed to purge export files",
        variant: "destructive",
      });
    },
  });

  const purgeJobMutation = useMutation({
    mutationFn: (jobId: string) =>
      axios.delete(`/api/admin/migration/export-jobs/${jobId}/files`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/export-jobs"] });
      toast({ title: "Export files removed" });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.response?.data?.message || "Failed to purge export files",
        variant: "destructive",
      });
    },
  });

  const importPurgeMutation = useMutation({
    mutationFn: (payload: { olderThanDays: number }) =>
      axios.post("/api/admin/migration/import-jobs/purge", payload).then((r) => r.data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/import-jobs"] });
      toast({
        title: "Import uploads purged",
        description: `Jobs: ${data?.jobsPurged ?? 0} | Files: ${data?.filesRemoved ?? 0}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.response?.data?.message || "Failed to purge import uploads",
        variant: "destructive",
      });
    },
  });

  const importPurgeJobMutation = useMutation({
    mutationFn: (jobId: string) =>
      axios.delete(`/api/admin/migration/import-jobs/${jobId}/files`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/import-jobs"] });
      toast({ title: "Import files removed" });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.response?.data?.message || "Failed to purge import files",
        variant: "destructive",
      });
    },
  });

  const formatTs = (ts?: number | null) => {
    if (!ts || !Number.isFinite(ts)) return "-";
    return new Date(ts).toLocaleString();
  };

  const totalRows = (totals?: Record<string, number> | null) => {
    if (!totals) return 0;
    return Object.values(totals).reduce((sum, val) => sum + Number(val || 0), 0);
  };

  const handleExport = () => {
    const payload: any = { scope: exportScope };
    if (exportScope === "USER_BUNDLE") {
      const id = Number(exportUserId);
      if (!exportUserId.trim() || !Number.isFinite(id) || id <= 0) {
        toast({ title: "Missing user ID", description: "Enter a valid user ID", variant: "destructive" });
        return;
      }
      payload.userId = id;
    }
    if (exportScope === "DELTA") {
      if (!exportSince) {
        toast({ title: "Missing timestamp", description: "Select a delta start time", variant: "destructive" });
        return;
      }
      const sinceTs = new Date(exportSince).getTime();
      if (!Number.isFinite(sinceTs)) {
        toast({ title: "Invalid timestamp", description: "Select a valid date/time", variant: "destructive" });
        return;
      }
      payload.sinceTs = sinceTs;
    }
    exportMutation.mutate(payload);
  };

  const parseManifestFile = async (file: File) => {
    try {
      const text = await file.text();
      const manifest = JSON.parse(text);
      const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
      const expectedFiles = chunks
        .map((c: any) => String(c?.file || ""))
        .filter((name: string) => name.trim().length > 0);
      const chunkingFlag = Boolean(manifest?.chunking?.enabled ?? false);
      const chunked = chunkingFlag || expectedFiles.length > 1;
      const chunkCount = expectedFiles.length > 0 ? expectedFiles.length : 1;
      setImportManifestMeta({ chunked, chunkCount, expectedFiles });
    } catch {
      setImportManifestMeta(null);
      toast({
        title: "Invalid manifest",
        description: "Could not parse JSON. Please select a valid migration manifest file.",
        variant: "destructive",
      });
    }
  };

  const importSelection = useMemo(() => {
    const meta = importManifestMeta;
    const selected = importDataFiles;

    if (!meta) {
      return {
        chunked: false,
        expectedCount: 0,
        selectedCount: selected.length,
        missing: [] as string[],
        extra: [] as string[],
        ok: selected.length > 0,
      };
    }

    const expected = meta.expectedFiles || [];
    const selectedNames = new Set(selected.map((f) => f.name));
    const missing = expected.filter((n) => !selectedNames.has(n));
    const extra = selected
      .map((f) => f.name)
      .filter((n) => expected.length > 0 && !expected.includes(n));

    const ok = meta.chunked ? (missing.length === 0 && extra.length === 0 && expected.length > 0) : selected.length > 0;

    return {
      chunked: meta.chunked,
      expectedCount: meta.chunkCount,
      selectedCount: selected.length,
      missing,
      extra,
      ok,
    };
  }, [importManifestMeta, importDataFiles]);

  const handleImport = () => {
    if (!importManifestFile) {
      toast({ title: "Missing manifest", description: "Select a manifest file", variant: "destructive" });
      return;
    }
    if (importDataFiles.length === 0) {
      toast({ title: "Missing data", description: "Select data file(s)", variant: "destructive" });
      return;
    }
    if (!importSelection.ok) {
      const missingText = importSelection.missing.length ? `Missing: ${importSelection.missing.join(", ")}` : "";
      const extraText = importSelection.extra.length ? `Extra: ${importSelection.extra.join(", ")}` : "";
      toast({
        title: "Data files do not match manifest",
        description: [missingText, extraText].filter(Boolean).join(" | ") || "Please select the required data files.",
        variant: "destructive",
      });
      return;
    }
    const form = new FormData();
    form.append("manifest", importManifestFile);
    if (importSelection.chunked) {
      for (const f of importDataFiles) {
        form.append("data", f);
      }
    } else {
      form.append("data", importDataFiles[0]);
    }
    form.append("mode", importMode);
    form.append("idStrategy", "PRESERVE");
    importMutation.mutate(form);
  };

  const handlePurge = () => {
    const days = Number(purgeDays);
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Invalid days", description: "Enter a positive number", variant: "destructive" });
      return;
    }
    purgeMutation.mutate({ olderThanDays: Math.floor(days) });
  };

  const handleImportPurge = () => {
    const days = Number(importPurgeDays);
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Invalid days", description: "Enter a positive number", variant: "destructive" });
      return;
    }
    importPurgeMutation.mutate({ olderThanDays: Math.floor(days) });
  };

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-6">
        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
          Migration controls include hidden <span className="font-medium">Hint</span> explainers for data integrity, chunking behavior, and retention impact.
        </div>
        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Migration Export/Import Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="w-full">
                <FieldHintLabel
                  label="Chunk exports/imports"
                  hint={MIGRATION_FIELD_HELP.chunkingEnabled.tooltip}
                  labelClassName="text-base font-medium"
                />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.chunkingEnabled.inline}</p>
              </div>
              <Switch
                checked={chunkingEnabledDraft}
                onCheckedChange={(v) => {
                  setChunkingEnabledDraft(Boolean(v));
                  setChunkSettingsDirty(true);
                }}
                disabled={systemConfigQuery.isLoading}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <FieldHintLabel label="Chunk size (GB)" hint={MIGRATION_FIELD_HELP.chunkSizeGb.tooltip} labelClassName="text-base font-medium" />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.chunkSizeGb.inline}</p>
                <Input
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={chunkSizeGbDraft}
                  onChange={(e) => {
                    setChunkSizeGbDraft(e.target.value);
                    setChunkSettingsDirty(true);
                  }}
                  className="bg-neutral-600 mt-2"
                  disabled={systemConfigQuery.isLoading}
                  title={MIGRATION_FIELD_HELP.chunkSizeGb.tooltip}
                />
                <p className="text-xs text-gray-400 mt-1">Stored as MB in DB. Minimum 0.25GB.</p>
              </div>
              <div className="md:col-span-2 flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">{chunkingSummary}</div>
                <Button
                  onClick={handleSaveChunkSettings}
                  disabled={systemConfigQuery.isLoading || saveChunkSettingsMutation.isPending || !chunkSettingsDirty}
                >
                  {saveChunkSettingsMutation.isPending ? "Saving..." : "Save Migration Settings"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="bg-neutral-700 border-gray-600">
            <CardHeader>
              <CardTitle className="text-base">Export (Backup or Migration)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <FieldHintLabel label="Scope" hint={MIGRATION_FIELD_HELP.exportScope.tooltip} labelClassName="text-base font-medium" />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.exportScope.inline}</p>
                <Select value={exportScope} onValueChange={setExportScope}>
                  <SelectTrigger className="bg-neutral-600 mt-2" title={MIGRATION_FIELD_HELP.exportScope.tooltip}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL_PLATFORM">Full platform</SelectItem>
                    <SelectItem value="USER_BUNDLE">Single trader bundle</SelectItem>
                    <SelectItem value="DELTA">Delta since timestamp</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {exportScope === "USER_BUNDLE" && (
                <div>
                  <FieldHintLabel label="Trader User ID" hint={MIGRATION_FIELD_HELP.exportUserId.tooltip} labelClassName="text-base font-medium" />
                  <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.exportUserId.inline}</p>
                  <Input
                    type="number"
                    value={exportUserId}
                    onChange={(e) => setExportUserId(e.target.value)}
                    className="bg-neutral-600 mt-2"
                    placeholder="e.g. 123"
                    title={MIGRATION_FIELD_HELP.exportUserId.tooltip}
                  />
                </div>
              )}

              {exportScope === "DELTA" && (
                <div>
                  <FieldHintLabel label="Since (local time)" hint={MIGRATION_FIELD_HELP.exportSince.tooltip} labelClassName="text-base font-medium" />
                  <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.exportSince.inline}</p>
                  <Input
                    type="datetime-local"
                    value={exportSince}
                    onChange={(e) => setExportSince(e.target.value)}
                    className="bg-neutral-600 mt-2"
                    title={MIGRATION_FIELD_HELP.exportSince.tooltip}
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">
                  NDJSON + manifest export. Includes audit trails and hashes.
                </div>
                <Button onClick={handleExport} disabled={exportMutation.isPending}>
                  {exportMutation.isPending ? "Creating..." : "Create Export Job"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-neutral-700 border-gray-600">
            <CardHeader>
              <CardTitle className="text-base">Import (Dry Run or Write)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <FieldHintLabel label="Mode" hint={MIGRATION_FIELD_HELP.importMode.tooltip} labelClassName="text-base font-medium" />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.importMode.inline}</p>
                <Select value={importMode} onValueChange={setImportMode}>
                  <SelectTrigger className="bg-neutral-600 mt-2" title={MIGRATION_FIELD_HELP.importMode.tooltip}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRY_RUN">Dry run (validate only)</SelectItem>
                    <SelectItem value="IMPORT">Import (write data)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <FieldHintLabel
                  label="Manifest (manifest.json)"
                  hint={MIGRATION_FIELD_HELP.importManifestFile.tooltip}
                  labelClassName="text-base font-medium"
                />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.importManifestFile.inline}</p>
                <Input
                  type="file"
                  accept=".json,application/json"
                  className="bg-neutral-600 mt-2"
                  title={MIGRATION_FIELD_HELP.importManifestFile.tooltip}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setImportManifestFile(file);
                    setImportDataFiles([]);
                    if (file) {
                      parseManifestFile(file);
                    } else {
                      setImportManifestMeta(null);
                    }
                  }}
                />
              </div>

              <div>
                <FieldHintLabel
                  label={importManifestMeta?.chunked ? "Data parts (*.ndjson) - select all" : "Data (data.ndjson)"}
                  hint={MIGRATION_FIELD_HELP.importDataFiles.tooltip}
                  labelClassName="text-base font-medium"
                />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.importDataFiles.inline}</p>
                <Input
                  type="file"
                  multiple={Boolean(importManifestMeta?.chunked)}
                  accept=".ndjson,application/x-ndjson"
                  className="bg-neutral-600 mt-2"
                  title={MIGRATION_FIELD_HELP.importDataFiles.tooltip}
                  onChange={(e) => setImportDataFiles(Array.from(e.target.files || []))}
                />
                {importManifestMeta?.chunked && (
                  <div className="text-xs text-gray-400 mt-2 space-y-1">
                    <div>
                      Expected parts: {importSelection.expectedCount} | Selected: {importSelection.selectedCount}
                    </div>
                    {importSelection.missing.length > 0 && (
                      <div className="text-amber-300">Missing: {importSelection.missing.join(", ")}</div>
                    )}
                    {importSelection.extra.length > 0 && (
                      <div className="text-amber-300">Extra: {importSelection.extra.join(", ")}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">
                  Preserves legacy IDs. Use empty target DB to avoid conflicts.
                </div>
                <Button onClick={handleImport} disabled={importMutation.isPending}>
                  {importMutation.isPending ? "Uploading..." : "Create Import Job"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Export Retention</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <FieldHintLabel
                label="Purge exports older than (days)"
                hint={MIGRATION_FIELD_HELP.purgeDays.tooltip}
                labelClassName="text-base font-medium"
              />
              <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.purgeDays.inline}</p>
              <Input
                type="number"
                min={1}
                value={purgeDays}
                onChange={(e) => setPurgeDays(e.target.value)}
                className="bg-neutral-600 mt-1 w-40"
                title={MIGRATION_FIELD_HELP.purgeDays.tooltip}
              />
              <p className="text-xs text-gray-400">
                Deletes export files from server storage; job metadata remains.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handlePurge}
              disabled={purgeMutation.isPending}
            >
              {purgeMutation.isPending ? "Purging..." : "Purge Exports"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Recent Export Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {exportJobsQuery.isLoading ? (
              <div className="text-sm text-gray-400">Loading export jobs...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Job ID</TableHead>
                    <TableHead className="text-xs">Scope</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Rows</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                    <TableHead className="text-xs">Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(exportJobsQuery.data || []).map((job) => {
                    const manifestChunks = Array.isArray(job.manifest?.chunks) ? job.manifest.chunks : [];
                    const chunkCount = manifestChunks.length;
                    const scriptCtx = chunkCount > 0 ? getScriptContext(job) : null;

                    return (
                      <TableRow key={job.id}>
                        <TableCell className="text-xs text-gray-200">{job.id}</TableCell>
                        <TableCell className="text-xs text-gray-300">{job.scope}</TableCell>
                        <TableCell className="text-xs text-gray-300">{job.status}</TableCell>
                        <TableCell className="text-xs text-gray-300">{totalRows(job.totals)}</TableCell>
                        <TableCell className="text-xs text-gray-400">{formatTs(job.createdAt)}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex gap-2">
                            {job.status === "READY" && (job.dataPath || job.manifestPath) ? (
                              <>
                                <Button size="sm" variant="outline" asChild>
                                  <a href={`/api/admin/migration/export-jobs/${job.id}/manifest`} rel="noreferrer">
                                    Manifest
                                  </a>
                                </Button>
                                <Button size="sm" variant="outline" asChild>
                                  <a href={`/api/admin/migration/export-jobs/${job.id}/data`} rel="noreferrer">
                                    {chunkCount > 1 ? "Part 0" : "Data"}
                                  </a>
                                </Button>
                                {chunkCount > 1 && (
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <Button size="sm" variant="outline">Parts ({chunkCount})</Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-lg bg-neutral-800 border-gray-700">
                                      <DialogHeader>
                                        <DialogTitle>Export parts ({chunkCount})</DialogTitle>
                                      </DialogHeader>
                                      {scriptCtx && (
                                        <div className="space-y-2">
                                          <div className="text-xs text-gray-400">
                                            Generated Linux scripts enforce a hard concurrency cap of 10.
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                downloadTextFile(
                                                  `download_${job.id}.sh`,
                                                  buildDownloadVerifyScript(scriptCtx)
                                                )
                                              }
                                            >
                                              Download Linux Script (Download + Verify)
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                downloadTextFile(
                                                  `download_missing_${job.id}.sh`,
                                                  buildMissingScript(scriptCtx)
                                                )
                                              }
                                            >
                                              Download Linux Script (Only Missing/Corrupt Parts)
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                downloadTextFile(
                                                  `import_upload_${job.id}.sh`,
                                                  buildImportScript(scriptCtx)
                                                )
                                              }
                                            >
                                              Download Linux Script (Import Upload)
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                      <div className="space-y-2 max-h-[60vh] overflow-auto mt-3">
                                        {manifestChunks.map((c: any) => (
                                          <div key={String(c?.index ?? c?.file)} className="flex items-center justify-between gap-3">
                                            <div className="text-xs text-gray-300 truncate">
                                              {String(c?.file || `Part ${c?.index}`)}
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs text-gray-500">{humanBytes(c?.sizeBytes ?? null)}</span>
                                              <Button size="sm" variant="outline" asChild>
                                                <a
                                                  href={`/api/admin/migration/export-jobs/${job.id}/chunks/${c?.index ?? 0}`}
                                                  rel="noreferrer"
                                                >
                                                  Download
                                                </a>
                                              </Button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                )}
                              </>
                            ) : (
                              <span className="text-gray-500">-</span>
                            )}
                            {(job.dataPath || job.manifestPath) && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => purgeJobMutation.mutate(job.id)}
                                disabled={purgeJobMutation.isPending}
                              >
                                Purge
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(exportJobsQuery.data || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-400 text-sm">
                        No export jobs yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Recent Import Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {importJobsQuery.isLoading ? (
              <div className="text-sm text-gray-400">Loading import jobs...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Job ID</TableHead>
                    <TableHead className="text-xs">Mode</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Rows</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                    <TableHead className="text-xs">Purge</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(importJobsQuery.data || []).map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="text-xs text-gray-200">{job.id}</TableCell>
                      <TableCell className="text-xs text-gray-300">{job.mode}</TableCell>
                      <TableCell className="text-xs text-gray-300">{job.status}</TableCell>
                      <TableCell className="text-xs text-gray-300">{totalRows(job.totals)}</TableCell>
                      <TableCell className="text-xs text-gray-400">{formatTs(job.createdAt)}</TableCell>
                      <TableCell className="text-xs">
                        {(job.dataPath || job.manifestPath) ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => importPurgeJobMutation.mutate(job.id)}
                            disabled={importPurgeJobMutation.isPending}
                          >
                            Purge
                          </Button>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(importJobsQuery.data || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-400 text-sm">
                        No import jobs yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Import Upload Retention</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <FieldHintLabel
                label="Purge imports older than (days)"
                hint={MIGRATION_FIELD_HELP.importPurgeDays.tooltip}
                labelClassName="text-base font-medium"
              />
              <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.importPurgeDays.inline}</p>
              <Input
                type="number"
                min={1}
                value={importPurgeDays}
                onChange={(e) => setImportPurgeDays(e.target.value)}
                className="bg-neutral-600 mt-1 w-40"
                title={MIGRATION_FIELD_HELP.importPurgeDays.tooltip}
              />
              <p className="text-xs text-gray-400">
                Deletes uploaded manifest/data files from server storage.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handleImportPurge}
              disabled={importPurgeMutation.isPending}
            >
              {importPurgeMutation.isPending ? "Purging..." : "Purge Imports"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function SystemConfigTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [subTab, setSubTab] = useState("trading");
  const [config, setConfig] = useState<SystemConfigData | null>(null);
  const [configChanged, setConfigChanged] = useState(false);
  const [i18nConfig, setI18nConfig] = useState<I18nAdminConfigData | null>(null);
  const [i18nLocalesCsv, setI18nLocalesCsv] = useState("en");
  const [i18nChanged, setI18nChanged] = useState(false);
  const [marketPerfSettings, setMarketPerfSettings] = useState<MarketPerformanceSettings>(
    DEFAULT_MARKET_PERFORMANCE_SETTINGS,
  );
  const [marketPerfChanged, setMarketPerfChanged] = useState(false);
  const marketPerfSyncGuardRef = useRef<MarketPerformanceSettings | null>(null);
  const marketPerfSchemaWarningRef = useRef(false);
  const [healthProviderKey, setHealthProviderKey] = useState<string>("");
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; key: string; value: boolean; label: string }>({
    open: false,
    key: "",
    value: false,
    label: ""
  });

  const { data: systemConfig, isLoading } = useQuery<SystemConfigData>({
    queryKey: ["/api/admin/system-config"],
    queryFn: () => axios.get("/api/admin/system-config").then(r => r.data),
  });

  const { data: globalPerformanceData, isFetchedAfterMount: globalPerformanceFetchedAfterMount } = useQuery<GlobalSettings>({
    queryKey: ["/api/admin/global-settings"],
    queryFn: () => axios.get("/api/admin/global-settings").then((r) => r.data),
  });

  const { data: i18nConfigData, isLoading: i18nConfigLoading } = useQuery<I18nAdminConfigData>({
    queryKey: ["/api/admin/i18n/config"],
    queryFn: () => axios.get("/api/admin/i18n/config").then((r) => r.data),
  });

  const { data: providersData } = useQuery<MarketDataProvidersResp>({
    queryKey: ["/api/admin/market-data/providers"],
    queryFn: () => axios.get("/api/admin/market-data/providers").then((r) => r.data),
  });

  const providers = useMemo(
    () => (providersData?.rows || []).filter((p) => !p.deletedAt && p.isEnabled),
    [providersData?.rows],
  );

  const { data: health, refetch: refetchHealth } = useQuery<SystemHealthData>({
    queryKey: ["/api/admin/system-health", healthProviderKey],
    queryFn: () =>
      axios
        .get("/api/admin/system-health", { params: healthProviderKey ? { providerKey: healthProviderKey } : undefined })
        .then((r) => r.data),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (healthProviderKey) return;
    const active = providersData?.activeKey ?? health?.activeProviderKey ?? null;
    if (active) setHealthProviderKey(active);
    else if (providers.length) setHealthProviderKey(providers[0].providerKey);
  }, [healthProviderKey, health?.activeProviderKey, providers, providersData?.activeKey]);

  const probeProviderMutation = useMutation({
    mutationFn: async () => {
      if (!healthProviderKey) throw new Error("Select a provider first");
      const res = await axios.post(
        `/api/admin/market-data/providers/${encodeURIComponent(healthProviderKey)}/test`,
        { symbols: ["EURUSD"] },
      );
      return res.data;
    },
    onSuccess: (data: any) => {
      toast({
        title: data?.ok ? "Provider probe OK" : "Provider probe failed",
        description: data?.ok ? `Quotes: ${data?.quoteCount ?? 0}` : String(data?.error ?? "Unknown error"),
        variant: data?.ok ? undefined : "destructive",
      });
    },
    onError: (e: any) => {
      toast({ title: "Provider probe failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  useEffect(() => {
    if (systemConfig && !configChanged) {
      setConfig(systemConfig);
    }
  }, [systemConfig]);

  useEffect(() => {
    if (!i18nConfigData || i18nChanged) return;
    const next = resolveI18nAdminConfig(i18nConfigData);
    setI18nConfig(next);
    setI18nLocalesCsv(next.supportedLocales.join(", "));
  }, [i18nChanged, i18nConfigData]);

  useEffect(() => {
    if (!globalPerformanceData || !globalPerformanceFetchedAfterMount || marketPerfSchemaWarningRef.current) return;
    const performanceSource = resolveGlobalPerformanceSettingsPayload(globalPerformanceData);
    if (
      "pollInstantMs" in performanceSource &&
      "flushInstantMs" in performanceSource &&
      "prefetchFastConcurrencyCap" in performanceSource &&
      "prefetchNetworkFastStartDelayMs" in performanceSource
    ) {
      return;
    }
    marketPerfSchemaWarningRef.current = true;
    toast({
      title: "Performance schema is outdated",
      description:
        "Server is missing tier performance fields. Run `npm run db:migrate:drizzle` and restart API for persistent admin performance controls, including prefetch tier caps/delay floors.",
      variant: "destructive",
    });
  }, [globalPerformanceData, globalPerformanceFetchedAfterMount, toast]);

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<SystemConfigData>) =>
      axios.put("/api/admin/system-config", payload).then(r => r.data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/signup-waitlist"] });
      setConfigChanged(false);
      toast({ title: "Settings saved", description: "System configuration updated successfully" });

      const s = data?.autoInviteSummary;
      if (s) {
        if (s?.ok === false) {
          toast({
            title: "Auto-invite failed",
            description: String(s?.error ?? "Unknown error"),
            variant: "destructive",
          });
        } else {
          const attempted = Number(s?.attempted ?? 0);
          const sent = Number(s?.sent ?? 0);
          const failed = Number(s?.failed ?? 0);
          const skipped = Number(s?.skipped ?? 0);
          const cap = Number(s?.batchCap ?? s?.cap ?? 0);

          if (attempted || sent || failed || skipped) {
            toast({
              title: "Auto-invite executed (unfreeze)",
              description: `Attempted: ${attempted} | Sent: ${sent} | Failed: ${failed} | Skipped: ${skipped}${cap ? ` | Cap: ${cap}` : ""}`,
              variant: failed > 0 ? "destructive" : undefined,
            });
          }
        }
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to save system configuration", variant: "destructive" });
    },
  });

  const updateMarketPerfMutation = useMutation({
    mutationFn: async (payload: MarketPerformanceSettings) => {
      await axios.put("/api/admin/global-settings", payload);
      const refreshed = await axios.get("/api/admin/global-settings", {
        params: { _ts: Date.now() },
      });
      return {
        requested: payload,
        persisted: refreshed.data as GlobalSettings,
      };
    },
    onSuccess: ({ requested, persisted }) => {
      const requestedSettings = resolveMarketPerformanceSettings(requested);
      const nextSettings = resolveMarketPerformanceSettings(persisted);
      marketPerfSyncGuardRef.current = nextSettings;
      setMarketPerfSettings(nextSettings);
      queryClient.setQueryData(["/api/admin/global-settings"], persisted);
      queryClient.setQueryData(["/api/global-settings"], (prev: unknown) => {
        if (!prev || typeof prev !== "object") return prev;
        return mergeGlobalSettingsPerformance(
          prev,
          nextSettings as Record<string, unknown>,
          persisted.updatedAt ?? null,
        );
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/global-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-settings"] });
      if (!marketPerformanceSettingsEqual(requestedSettings, nextSettings)) {
        setMarketPerfChanged(true);
        toast({
          title: "Saved with adjustments",
          description:
            "One or more values were normalized by the server or overwritten by a concurrent save. Review values and save again if needed.",
          variant: "destructive",
        });
        return;
      }
      setMarketPerfChanged(false);
      toast({ title: "Performance settings saved", description: "Market data performance defaults updated." });
    },
    onError: (error: any) => {
      marketPerfSyncGuardRef.current = null;
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to save performance settings",
        variant: "destructive",
      });
    },
  });

  const updateI18nMutation = useMutation({
    mutationFn: async (payload: {
      enabled: boolean;
      defaultLocale: string;
      supportedLocales: string[];
      autoTranslate: boolean;
      llmEnabled: boolean;
      llmProvider: string;
      llmModel: string;
      llmMaxBatchSize: number;
      llmMaxAttempts: number;
    }) => axios.put("/api/admin/i18n/config", payload).then((r) => r.data),
    onSuccess: (data: any) => {
      const next = resolveI18nAdminConfig(data);
      setI18nConfig(next);
      setI18nLocalesCsv(next.supportedLocales.join(", "));
      setI18nChanged(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/i18n/config"] });
      queryClient.invalidateQueries({ queryKey: ["i18nConfig"] });
      toast({ title: "I18n settings saved", description: "Language/system localization settings updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to save i18n settings",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!globalPerformanceData || marketPerfChanged || updateMarketPerfMutation.isPending) return;
    const resolved = resolveMarketPerformanceSettings(globalPerformanceData);
    const guard = marketPerfSyncGuardRef.current;
    if (guard && !marketPerformanceSettingsEqual(resolved, guard)) return;
    marketPerfSyncGuardRef.current = null;
    setMarketPerfSettings((prev) => (marketPerformanceSettingsEqual(prev, resolved) ? prev : resolved));
  }, [globalPerformanceData, marketPerfChanged, updateMarketPerfMutation.isPending]);

  const handleMarketPerfSettingChange = <K extends keyof MarketPerformanceSettings>(
    key: K,
    value: MarketPerformanceSettings[K],
  ) => {
    marketPerfSyncGuardRef.current = null;
    setMarketPerfSettings((prev) => ({ ...prev, [key]: value }));
    setMarketPerfChanged(true);
  };

  const saveMarketPerformanceSettings = () => {
    updateMarketPerfMutation.mutate({ ...marketPerfSettings });
  };

  const marketPerfPreviewRows = useMemo(() => {
    return PERFORMANCE_TIERS.map((tier) => ({
      tier,
      pollKey: TIER_POLL_SETTING_KEYS[tier],
      flushKey: TIER_FLUSH_SETTING_KEYS[tier],
    }));
  }, []);

  const handleToggleChange = (key: string, value: boolean, label: string) => {
    // Dangerous toggles require confirmation
    if (key === "maintenanceMode" || key === "tradingHalt" || key === "closeOnlyMode") {
      setConfirmDialog({ open: true, key, value, label });
    } else {
      setConfig(prev => prev ? { ...prev, [key]: value } : prev);
      setConfigChanged(true);
    }
  };

  const confirmToggle = () => {
    setConfig(prev => prev ? { ...prev, [confirmDialog.key]: confirmDialog.value } : prev);
    setConfigChanged(true);
    setConfirmDialog({ open: false, key: "", value: false, label: "" });
  };

  const handleSave = () => {
    if (config) {
      updateMutation.mutate(config);
    }
  };

  const handleSaveI18nConfig = () => {
    if (!i18nConfig) return;
    const supportedLocales = parseLocaleCsvInput(i18nLocalesCsv);
    if (supportedLocales.length === 0) {
      toast({ title: "Invalid locales", description: "Add at least one supported locale.", variant: "destructive" });
      return;
    }
    const defaultLocale = String(i18nConfig.defaultLocale || "").trim() || "en";
    if (!supportedLocales.find((locale) => locale.toLowerCase() === defaultLocale.toLowerCase())) {
      supportedLocales.unshift(defaultLocale);
    }

    updateI18nMutation.mutate({
      enabled: Boolean(i18nConfig.enabled),
      defaultLocale,
      supportedLocales,
      autoTranslate: Boolean(i18nConfig.autoTranslate),
      llmEnabled: Boolean(i18nConfig.llmEnabled),
      llmProvider: String(i18nConfig.llmProvider || "openai").trim() || "openai",
      llmModel: String(i18nConfig.llmModel || "gpt-4o-mini").trim() || "gpt-4o-mini",
      llmMaxBatchSize: Math.max(1, Math.min(200, Number(i18nConfig.llmMaxBatchSize) || 50)),
      llmMaxAttempts: Math.max(1, Math.min(10, Number(i18nConfig.llmMaxAttempts) || 3)),
    });
  };

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">System Configuration</h2>
      <p className="text-gray-400 text-sm mb-4">Manage platform-wide operational controls, API integration, and performance parameters.</p>

      <Tabs value={subTab} onValueChange={setSubTab} className="space-y-4">
        <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-1">
          <TabsTrigger value="trading" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Trading Controls</TabsTrigger>
          <TabsTrigger value="market" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Market Data</TabsTrigger>
          <TabsTrigger value="compliance" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Signup Compliance</TabsTrigger>
          <TabsTrigger value="system" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Language</TabsTrigger>
          <TabsTrigger value="controls" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Controls</TabsTrigger>
          <TabsTrigger value="migration" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Migration</TabsTrigger>
          <TabsTrigger value="health" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">System Health</TabsTrigger>
        </TabsList>

        {/* TRADING CONTROLS */}
        <TabsContent value="trading">
          <Card className="bg-neutral-700 border-gray-600">
            <CardHeader>
              <CardTitle className="text-base">Trading Controls & Safety Switches</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <TooltipProvider delayDuration={120}>
                <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                  Configure platform-wide trade safety switches. Use hidden <span className="font-medium">Hint</span> links for rollout impact and risk behavior details.
                </div>

                <div className="flex justify-between items-center py-3 border-b border-gray-600">
                  <div className="w-full">
                    <FieldHintLabel
                      label="Maintenance Mode"
                      hint={TRADING_CONTROLS_FIELD_HELP.maintenanceMode.tooltip}
                      labelClassName="text-base font-medium"
                    />
                    <p className="text-xs text-gray-400 mt-1">{TRADING_CONTROLS_FIELD_HELP.maintenanceMode.inline}</p>
                  </div>
                  <Switch
                    checked={config.maintenanceMode}
                    onCheckedChange={(v) => handleToggleChange("maintenanceMode", v, "Maintenance Mode")}
                  />
                </div>

                <div className="flex justify-between items-center py-3 border-b border-gray-600">
                  <div className="w-full">
                    <FieldHintLabel
                      label="Trading Halt (Kill Switch)"
                      hint={TRADING_CONTROLS_FIELD_HELP.tradingHalt.tooltip}
                      labelClassName="text-base font-medium text-red-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">{TRADING_CONTROLS_FIELD_HELP.tradingHalt.inline}</p>
                  </div>
                  <Switch
                    checked={config.tradingHalt}
                    onCheckedChange={(v) => handleToggleChange("tradingHalt", v, "Trading Halt")}
                  />
                </div>

                <div className="flex justify-between items-center py-3 border-b border-gray-600">
                  <div className="w-full">
                    <FieldHintLabel
                      label="Close-Only Mode"
                      hint={TRADING_CONTROLS_FIELD_HELP.closeOnlyMode.tooltip}
                      labelClassName="text-base font-medium text-amber-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">{TRADING_CONTROLS_FIELD_HELP.closeOnlyMode.inline}</p>
                  </div>
                  <Switch
                    checked={config.closeOnlyMode}
                    onCheckedChange={(v) => handleToggleChange("closeOnlyMode", v, "Close-Only Mode")}
                  />
                </div>

                <div className="flex justify-between items-center py-3 border-b border-gray-600">
                  <div className="w-full">
                    <FieldHintLabel
                      label="Block Open on Stale Quotes"
                      hint={TRADING_CONTROLS_FIELD_HELP.blockOpenOnStaleQuotes.tooltip}
                      labelClassName="text-base font-medium"
                    />
                    <p className="text-xs text-gray-400 mt-1">{TRADING_CONTROLS_FIELD_HELP.blockOpenOnStaleQuotes.inline}</p>
                  </div>
                  <Switch
                    checked={config.blockOpenOnStaleQuotes}
                    onCheckedChange={(v) => {
                      setConfig(prev => prev ? { ...prev, blockOpenOnStaleQuotes: v } : prev);
                      setConfigChanged(true);
                    }}
                  />
                </div>

                <div className="py-3">
                  <FieldHintLabel
                    label="Maintenance Message"
                    hint={TRADING_CONTROLS_FIELD_HELP.maintenanceMessage.tooltip}
                    labelClassName="text-base font-medium"
                  />
                  <p className="text-xs text-gray-400 mt-1">{TRADING_CONTROLS_FIELD_HELP.maintenanceMessage.inline}</p>
                  <Input
                    value={config.maintenanceMessage}
                    onChange={(e) => {
                      setConfig(prev => prev ? { ...prev, maintenanceMessage: e.target.value } : prev);
                      setConfigChanged(true);
                    }}
                    className="bg-neutral-600 mt-2"
                    title={TRADING_CONTROLS_FIELD_HELP.maintenanceMessage.tooltip}
                  />
                </div>

                <div className="flex justify-end pt-4">
                  <Button
                    onClick={handleSave}
                    disabled={!configChanged || updateMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {updateMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </TooltipProvider>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MARKET DATA & REFRESH */}
        <TabsContent value="market">
          <div className="space-y-4">
            <MarketDataProvidersCard />

            <Card className="bg-neutral-700 border-gray-600">
              <CardHeader>
                <CardTitle className="text-base">Market Data & Quote Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <TooltipProvider delayDuration={120}>
                  <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                    Configure quote fetch cadence and stale-detection guardrails. Use the hidden <span className="font-medium">Hint</span> controls for deeper operational impact notes.
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <FieldHintLabel
                        label="Client Quote Refresh (ms)"
                        hint={MARKET_DATA_QUOTE_FIELD_HELP.quoteRefreshMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_DATA_QUOTE_FIELD_HELP.quoteRefreshMs.inline}</p>
                      <Input
                        type="number"
                        value={config.quoteRefreshMs}
                        onChange={(e) => {
                          setConfig(prev => prev ? { ...prev, quoteRefreshMs: Number(e.target.value) } : prev);
                          setConfigChanged(true);
                        }}
                        className="bg-neutral-600 mt-2"
                        min={100}
                        title={MARKET_DATA_QUOTE_FIELD_HELP.quoteRefreshMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Server Feed Poll (ms)"
                        hint={MARKET_DATA_QUOTE_FIELD_HELP.feedPollMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_DATA_QUOTE_FIELD_HELP.feedPollMs.inline}</p>
                      <Input
                        type="number"
                        value={config.feedPollMs}
                        onChange={(e) => {
                          setConfig(prev => prev ? { ...prev, feedPollMs: Number(e.target.value) } : prev);
                          setConfigChanged(true);
                        }}
                        className="bg-neutral-600 mt-2"
                        min={100}
                        title={MARKET_DATA_QUOTE_FIELD_HELP.feedPollMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Stale Threshold (ms)"
                        hint={MARKET_DATA_QUOTE_FIELD_HELP.staleThresholdMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_DATA_QUOTE_FIELD_HELP.staleThresholdMs.inline}</p>
                      <Input
                        type="number"
                        value={config.staleThresholdMs}
                        onChange={(e) => {
                          setConfig(prev => prev ? { ...prev, staleThresholdMs: Number(e.target.value) } : prev);
                          setConfigChanged(true);
                        }}
                        className="bg-neutral-600 mt-2"
                        min={1000}
                        title={MARKET_DATA_QUOTE_FIELD_HELP.staleThresholdMs.tooltip}
                      />
                    </div>
                  </div>

                  <FxRolloverSettings
                    config={config}
                    setConfig={setConfig}
                    setConfigChanged={setConfigChanged}
                  />

                  <div className="bg-green-900/30 border border-green-700/50 p-4 rounded-lg mt-4">
                    <p className="text-sm text-green-300">
                      <strong>Note:</strong> Changes to feed polling rates and stale thresholds take effect immediately
                      without requiring a server restart.
                    </p>
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={handleSave}
                      disabled={!configChanged || updateMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {updateMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>

            <Card className="bg-neutral-700 border-gray-600">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-base">Adaptive Client Performance Controls: Phone + Internet Profiles</CardTitle>
                  <p className="text-xs text-gray-400 mt-1">
                    Tune quote delivery by device/network quality. Lower milliseconds mean faster updates, higher
                    bandwidth/battery usage; higher milliseconds reduce load for slower phones and weaker internet.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Each tier below maps to a phone + connection profile, from INSTANT (strong Wi-Fi/5G) to MINIMAL
                    (very constrained network). All values are editable, saved, and live-propagated.
                  </p>
                </div>
                <Button
                  onClick={saveMarketPerformanceSettings}
                  disabled={!marketPerfChanged || updateMarketPerfMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
                >
                  {updateMarketPerfMutation.isPending ? "Saving..." : "Save Performance"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-5">
                <TooltipProvider delayDuration={120}>
                  <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                    Assign lower-latency tiers to users on newer phones and stronger internet. For slower phones or
                    weak cellular links, raise intervals to cut bandwidth, battery drain, and reconnect churn.
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <FieldHintLabel
                        label="REST Fallback Poll (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.restFallbackPollMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.restFallbackPollMs.inline}</p>
                      <Input
                        type="number"
                        min={100}
                        max={60000}
                        value={marketPerfSettings.restFallbackPollMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "restFallbackPollMs",
                            Math.max(100, Math.min(60_000, Number(e.target.value) || 500)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.restFallbackPollMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="WS Push Frequency (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.wsPushFrequencyMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.wsPushFrequencyMs.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={1000}
                        value={marketPerfSettings.wsPushFrequencyMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "wsPushFrequencyMs",
                            Math.max(0, Math.min(1_000, Number(e.target.value) || 0)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.wsPushFrequencyMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Quote Flush Interval (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.quoteFlushIntervalMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.quoteFlushIntervalMs.inline}</p>
                      <Input
                        type="number"
                        min={20}
                        max={5000}
                        value={marketPerfSettings.quoteFlushIntervalMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "quoteFlushIntervalMs",
                            Math.max(20, Math.min(5_000, Number(e.target.value) || 50)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.quoteFlushIntervalMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Max WS Reconnect Attempts"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.maxWsReconnectAttempts.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.maxWsReconnectAttempts.inline}</p>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={marketPerfSettings.maxWsReconnectAttempts}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "maxWsReconnectAttempts",
                            Math.max(1, Math.min(30, Number(e.target.value) || 30)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.maxWsReconnectAttempts.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="WS Reconnect Base Delay (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.wsReconnectBaseDelayMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.wsReconnectBaseDelayMs.inline}</p>
                      <Input
                        type="number"
                        min={100}
                        max={30000}
                        value={marketPerfSettings.wsReconnectBaseDelayMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "wsReconnectBaseDelayMs",
                            Math.max(100, Math.min(30_000, Number(e.target.value) || 1500)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.wsReconnectBaseDelayMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch Strategy"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchStrategy.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchStrategy.inline}</p>
                      <Select
                        value={marketPerfSettings.prefetchStrategy}
                        onValueChange={(value) =>
                          handleMarketPerfSettingChange(
                            "prefetchStrategy",
                            value as MarketPerformanceSettings["prefetchStrategy"],
                          )}
                      >
                        <SelectTrigger
                          className="bg-neutral-600 mt-2"
                          title={MARKET_PERFORMANCE_FIELD_HELP.prefetchStrategy.tooltip}
                        >
                          <SelectValue placeholder="Select strategy" />
                        </SelectTrigger>
                        <SelectContent className="bg-neutral-700">
                          <SelectItem value="all">All Chunks</SelectItem>
                          <SelectItem value="critical">Critical Only</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch Max Concurrency"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchMaxConcurrency.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchMaxConcurrency.inline}</p>
                      <Input
                        type="number"
                        min={1}
                        max={6}
                        value={marketPerfSettings.prefetchMaxConcurrency}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchMaxConcurrency",
                            Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchMaxConcurrency.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch Start Delay (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchStartDelayMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchStartDelayMs.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={15000}
                        value={marketPerfSettings.prefetchStartDelayMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchStartDelayMs",
                            Math.max(0, Math.min(15_000, Number(e.target.value) || 0)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchStartDelayMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch FAST Concurrency Cap"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchFastConcurrencyCap.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchFastConcurrencyCap.inline}</p>
                      <Input
                        type="number"
                        min={1}
                        max={6}
                        value={marketPerfSettings.prefetchFastConcurrencyCap}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchFastConcurrencyCap",
                            Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchFastConcurrencyCap.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch MODERATE Concurrency Cap"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchModerateConcurrencyCap.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchModerateConcurrencyCap.inline}</p>
                      <Input
                        type="number"
                        min={1}
                        max={6}
                        value={marketPerfSettings.prefetchModerateConcurrencyCap}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchModerateConcurrencyCap",
                            Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchModerateConcurrencyCap.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch CONSTRAINED Concurrency Cap"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchConstrainedConcurrencyCap.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchConstrainedConcurrencyCap.inline}</p>
                      <Input
                        type="number"
                        min={1}
                        max={6}
                        value={marketPerfSettings.prefetchConstrainedConcurrencyCap}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchConstrainedConcurrencyCap",
                            Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchConstrainedConcurrencyCap.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch FAST Network Delay Floor (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkFastStartDelayMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkFastStartDelayMs.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={15000}
                        value={marketPerfSettings.prefetchNetworkFastStartDelayMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchNetworkFastStartDelayMs",
                            Math.max(0, Math.min(15_000, Number(e.target.value) || 0)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkFastStartDelayMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch MODERATE Network Delay Floor (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkModerateStartDelayMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkModerateStartDelayMs.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={15000}
                        value={marketPerfSettings.prefetchNetworkModerateStartDelayMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchNetworkModerateStartDelayMs",
                            Math.max(0, Math.min(15_000, Number(e.target.value) || 0)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkModerateStartDelayMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch CONSTRAINED Network Delay Floor (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkConstrainedStartDelayMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkConstrainedStartDelayMs.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={15000}
                        value={marketPerfSettings.prefetchNetworkConstrainedStartDelayMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchNetworkConstrainedStartDelayMs",
                            Math.max(0, Math.min(15_000, Number(e.target.value) || 0)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchNetworkConstrainedStartDelayMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch MODERATE Device Delay Floor (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceModerateStartDelayMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceModerateStartDelayMs.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={15000}
                        value={marketPerfSettings.prefetchDeviceModerateStartDelayMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchDeviceModerateStartDelayMs",
                            Math.max(0, Math.min(15_000, Number(e.target.value) || 0)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceModerateStartDelayMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch CONSTRAINED Device Delay Floor (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceConstrainedStartDelayMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceConstrainedStartDelayMs.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={15000}
                        value={marketPerfSettings.prefetchDeviceConstrainedStartDelayMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchDeviceConstrainedStartDelayMs",
                            Math.max(0, Math.min(15_000, Number(e.target.value) || 0)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceConstrainedStartDelayMs.tooltip}
                      />
                    </div>

                    <div>
                      <FieldHintLabel
                        label="Prefetch MINIMAL Device Delay Floor (ms)"
                        hint={MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceMinimalStartDelayMs.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceMinimalStartDelayMs.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={15000}
                        value={marketPerfSettings.prefetchDeviceMinimalStartDelayMs}
                        onChange={(e) =>
                          handleMarketPerfSettingChange(
                            "prefetchDeviceMinimalStartDelayMs",
                            Math.max(0, Math.min(15_000, Number(e.target.value) || 0)),
                          )}
                        className="bg-neutral-600 mt-2"
                        title={MARKET_PERFORMANCE_FIELD_HELP.prefetchDeviceMinimalStartDelayMs.tooltip}
                      />
                    </div>
                  </div>

                  <div className="rounded-md border border-gray-600 overflow-hidden">
                    <div className="grid grid-cols-3 bg-neutral-800 px-3 py-2 text-xs font-semibold text-gray-300">
                      <div className="flex items-center justify-between gap-2 pr-2">
                        <span>Tier</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                              aria-label="Tier column hint"
                            >
                              Hint
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                            {MARKET_PERFORMANCE_TIER_TABLE_HELP.tier}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center justify-between gap-2 pr-2">
                        <span>Tier Poll (ms)</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                              aria-label="Tier poll column hint"
                            >
                              Hint
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                            {MARKET_PERFORMANCE_TIER_TABLE_HELP.tierPollMs}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center justify-between gap-2 pr-2">
                        <span>Tier Flush (ms)</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                              aria-label="Tier flush column hint"
                            >
                              Hint
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                            {MARKET_PERFORMANCE_TIER_TABLE_HELP.tierFlushMs}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    {marketPerfPreviewRows.map((row) => {
                      const tierHint = MARKET_PERFORMANCE_TIER_HELP[row.tier];
                      return (
                        <div key={row.tier} className="grid grid-cols-3 px-3 py-2 text-sm border-t border-gray-700">
                          <div>
                            <div className="flex items-center justify-between gap-2 pr-2">
                              <div>{row.tier}</div>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                    aria-label={`${row.tier} tier hint`}
                                  >
                                    Hint
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                                  {`${tierHint} Assign this tier to users matching this phone + network profile.`}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1">{tierHint}</p>
                          </div>
                          <div>
                            <div className="mb-1 flex items-center justify-between gap-2 pr-2">
                              <span className="text-[11px] text-gray-400">{row.tier} Poll</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                    aria-label={`${row.tier} poll hint`}
                                  >
                                    Hint
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                                  {`${tierHint} Lower poll values improve quote freshness; higher values reduce data and battery usage.`}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <Input
                              type="number"
                              min={100}
                              max={60_000}
                              value={marketPerfSettings[row.pollKey]}
                              onChange={(e) =>
                                handleMarketPerfSettingChange(
                                  row.pollKey,
                                  Math.max(100, Math.min(60_000, Number(e.target.value) || 100)),
                                )}
                              className="bg-neutral-600 h-8"
                              title={`${tierHint} Lower poll values improve quote freshness; higher values reduce data and battery usage.`}
                            />
                          </div>
                          <div>
                            <div className="mb-1 flex items-center justify-between gap-2 pr-2">
                              <span className="text-[11px] text-gray-400">{row.tier} Flush</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                    aria-label={`${row.tier} flush hint`}
                                  >
                                    Hint
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                                  {`${tierHint} Lower flush values deliver updates faster; higher values reduce burst traffic on weak networks.`}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <Input
                              type="number"
                              min={20}
                              max={5_000}
                              value={marketPerfSettings[row.flushKey]}
                              onChange={(e) =>
                                handleMarketPerfSettingChange(
                                  row.flushKey,
                                  Math.max(20, Math.min(5_000, Number(e.target.value) || 20)),
                                )}
                              className="bg-neutral-600 h-8"
                              title={`${tierHint} Lower flush values deliver updates faster; higher values reduce burst traffic on weak networks.`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* SIGNUP COMPLIANCE */}
        <TabsContent value="compliance">
          <div className="space-y-4">
            <Card className="bg-neutral-700 border-gray-600">
              <CardHeader>
                <CardTitle className="text-base">Signup Compliance & Verification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <TooltipProvider delayDuration={120}>
                  <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                    Configure signup verification and legal gating. Use each hidden <span className="font-medium">Hint</span> for deeper enforcement behavior and rollout cautions.
                  </div>

                  <div className="flex justify-between items-center py-3 border-b border-gray-600">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Enforce Signup CAPTCHA"
                        hint={SIGNUP_COMPLIANCE_FIELD_HELP.signupCaptchaEnforce.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{SIGNUP_COMPLIANCE_FIELD_HELP.signupCaptchaEnforce.inline}</p>
                    </div>
                    <Switch
                      checked={config.signupCaptchaEnforce}
                      onCheckedChange={(v) => {
                        setConfig(prev => prev ? { ...prev, signupCaptchaEnforce: v } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>

                  <div className="py-3 border-b border-gray-600">
                    <FieldHintLabel
                      label="Captcha Provider"
                      hint={SIGNUP_COMPLIANCE_FIELD_HELP.captchaProvider.tooltip}
                      labelClassName="text-base font-medium"
                    />
                    <p className="text-xs text-gray-400 mt-1">{SIGNUP_COMPLIANCE_FIELD_HELP.captchaProvider.inline}</p>
                    <Select
                      value={config.captchaProvider}
                      onValueChange={(val) => {
                        setConfig(prev => prev ? { ...prev, captchaProvider: val } : prev);
                        setConfigChanged(true);
                      }}
                    >
                      <SelectTrigger className="bg-neutral-600 mt-2" title={SIGNUP_COMPLIANCE_FIELD_HELP.captchaProvider.tooltip}>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent className="bg-neutral-700">
                        <SelectItem value="TURNSTILE">Turnstile</SelectItem>
                        <SelectItem value="HCAPTCHA">hCaptcha</SelectItem>
                        <SelectItem value="SLIDER">Slider</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-between items-center py-3 border-b border-gray-600">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Require Phone on Signup"
                        hint={SIGNUP_COMPLIANCE_FIELD_HELP.signupPhoneEnforce.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{SIGNUP_COMPLIANCE_FIELD_HELP.signupPhoneEnforce.inline}</p>
                    </div>
                    <Switch
                      checked={config.signupPhoneEnforce}
                      onCheckedChange={(v) => {
                        setConfig(prev => prev ? { ...prev, signupPhoneEnforce: v } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>

                  <div className="flex justify-between items-center py-3">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Enforce Legal Coverage Gate"
                        hint={SIGNUP_COMPLIANCE_FIELD_HELP.legalCoverageEnforce.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{SIGNUP_COMPLIANCE_FIELD_HELP.legalCoverageEnforce.inline}</p>
                    </div>
                    <Switch
                      checked={config.legalCoverageEnforce}
                      onCheckedChange={(v) => {
                        setConfig(prev => prev ? { ...prev, legalCoverageEnforce: v } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={handleSave}
                      disabled={!configChanged || updateMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {updateMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>

            <SignupFreezeWaitlistCard
              config={config}
              setConfig={setConfig}
              setConfigChanged={setConfigChanged}
              onSave={handleSave}
              saving={updateMutation.isPending}
              canSave={configChanged}
            />

            {config && (
              <JurisdictionControlsCard
                config={config}
                setConfig={setConfig}
                setConfigChanged={setConfigChanged}
                configChanged={configChanged}
                onSave={handleSave}
                saving={updateMutation.isPending}
              />
            )}
          </div>
        </TabsContent>

        {/* SYSTEM CONFIG */}
        <TabsContent value="system">
          {!i18nConfig || i18nConfigLoading ? (
            <Card className="bg-neutral-700 border-gray-600">
              <CardContent className="py-6 text-sm text-gray-400">Loading i18n/language settings...</CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card className="bg-neutral-700 border-gray-600">
                <CardHeader>
                  <CardTitle className="text-base">I18n / Language Controls</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TooltipProvider delayDuration={120}>
                    <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                      Configure localization defaults and translation worker controls. Use hidden <span className="font-medium">Hint</span> links for behavior and rollout guidance.
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-3">
                        <div className="w-full">
                          <FieldHintLabel
                            label="Enable i18n"
                            hint={SYSTEM_I18N_FIELD_HELP.enabled.tooltip}
                            labelClassName="text-sm font-medium"
                          />
                          <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.enabled.inline}</p>
                        </div>
                        <Switch
                          checked={Boolean(i18nConfig.enabled)}
                          onCheckedChange={(checked) => {
                            setI18nConfig((prev) => (prev ? { ...prev, enabled: Boolean(checked) } : prev));
                            setI18nChanged(true);
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-3">
                        <div className="w-full">
                          <FieldHintLabel
                            label="Auto-translate missing strings"
                            hint={SYSTEM_I18N_FIELD_HELP.autoTranslate.tooltip}
                            labelClassName="text-sm font-medium"
                          />
                          <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.autoTranslate.inline}</p>
                        </div>
                        <Switch
                          checked={Boolean(i18nConfig.autoTranslate)}
                          onCheckedChange={(checked) => {
                            setI18nConfig((prev) => (prev ? { ...prev, autoTranslate: Boolean(checked) } : prev));
                            setI18nChanged(true);
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-3">
                        <div className="w-full">
                          <FieldHintLabel
                            label="Enable LLM translation worker"
                            hint={SYSTEM_I18N_FIELD_HELP.llmEnabled.tooltip}
                            labelClassName="text-sm font-medium"
                          />
                          <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.llmEnabled.inline}</p>
                        </div>
                        <Switch
                          checked={Boolean(i18nConfig.llmEnabled)}
                          onCheckedChange={(checked) => {
                            setI18nConfig((prev) => (prev ? { ...prev, llmEnabled: Boolean(checked) } : prev));
                            setI18nChanged(true);
                          }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <FieldHintLabel label="Default Locale" hint={SYSTEM_I18N_FIELD_HELP.defaultLocale.tooltip} />
                        <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.defaultLocale.inline}</p>
                        <Input
                          value={i18nConfig.defaultLocale}
                          onChange={(e) => {
                            const value = e.target.value;
                            setI18nConfig((prev) => (prev ? { ...prev, defaultLocale: value } : prev));
                            setI18nChanged(true);
                          }}
                          className="bg-neutral-600 mt-2"
                          placeholder="en"
                          title={SYSTEM_I18N_FIELD_HELP.defaultLocale.tooltip}
                        />
                      </div>
                      <div>
                        <FieldHintLabel label="Supported Locales (CSV)" hint={SYSTEM_I18N_FIELD_HELP.supportedLocales.tooltip} />
                        <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.supportedLocales.inline}</p>
                        <Input
                          value={i18nLocalesCsv}
                          onChange={(e) => {
                            setI18nLocalesCsv(e.target.value);
                            setI18nChanged(true);
                          }}
                          className="bg-neutral-600 mt-2"
                          placeholder="en, fr, es"
                          title={SYSTEM_I18N_FIELD_HELP.supportedLocales.tooltip}
                        />
                      </div>
                      <div>
                        <FieldHintLabel label="LLM Provider" hint={SYSTEM_I18N_FIELD_HELP.llmProvider.tooltip} />
                        <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.llmProvider.inline}</p>
                        <Input
                          value={i18nConfig.llmProvider}
                          onChange={(e) => {
                            const value = e.target.value;
                            setI18nConfig((prev) => (prev ? { ...prev, llmProvider: value } : prev));
                            setI18nChanged(true);
                          }}
                          className="bg-neutral-600 mt-2"
                          placeholder="openai"
                          title={SYSTEM_I18N_FIELD_HELP.llmProvider.tooltip}
                        />
                      </div>
                      <div>
                        <FieldHintLabel label="LLM Model" hint={SYSTEM_I18N_FIELD_HELP.llmModel.tooltip} />
                        <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.llmModel.inline}</p>
                        <Input
                          value={i18nConfig.llmModel}
                          onChange={(e) => {
                            const value = e.target.value;
                            setI18nConfig((prev) => (prev ? { ...prev, llmModel: value } : prev));
                            setI18nChanged(true);
                          }}
                          className="bg-neutral-600 mt-2"
                          placeholder="gpt-4o-mini"
                          title={SYSTEM_I18N_FIELD_HELP.llmModel.tooltip}
                        />
                      </div>
                      <div>
                        <FieldHintLabel label="LLM Max Batch Size" hint={SYSTEM_I18N_FIELD_HELP.llmMaxBatchSize.tooltip} />
                        <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.llmMaxBatchSize.inline}</p>
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          value={Number(i18nConfig.llmMaxBatchSize ?? 50)}
                          onChange={(e) => {
                            const value = Math.max(1, Math.min(200, Number(e.target.value) || 50));
                            setI18nConfig((prev) => (prev ? { ...prev, llmMaxBatchSize: value } : prev));
                            setI18nChanged(true);
                          }}
                          className="bg-neutral-600 mt-2"
                          title={SYSTEM_I18N_FIELD_HELP.llmMaxBatchSize.tooltip}
                        />
                      </div>
                      <div>
                        <FieldHintLabel label="LLM Max Attempts" hint={SYSTEM_I18N_FIELD_HELP.llmMaxAttempts.tooltip} />
                        <p className="text-xs text-gray-400 mt-1">{SYSTEM_I18N_FIELD_HELP.llmMaxAttempts.inline}</p>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={Number(i18nConfig.llmMaxAttempts ?? 3)}
                          onChange={(e) => {
                            const value = Math.max(1, Math.min(10, Number(e.target.value) || 3));
                            setI18nConfig((prev) => (prev ? { ...prev, llmMaxAttempts: value } : prev));
                            setI18nChanged(true);
                          }}
                          className="bg-neutral-600 mt-2"
                          title={SYSTEM_I18N_FIELD_HELP.llmMaxAttempts.tooltip}
                        />
                      </div>
                    </div>

                    <div className="text-xs text-gray-400">
                      Include the default locale in supported locales. Save applies to web/mobile i18n config fetches.
                    </div>

                    <div className="flex justify-end">
                      <Button
                        onClick={handleSaveI18nConfig}
                        disabled={!i18nChanged || updateI18nMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {updateI18nMutation.isPending ? "Saving..." : "Save I18n Settings"}
                      </Button>
                    </div>
                  </TooltipProvider>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* CONTROLS */}
        <TabsContent value="controls">
          <TooltipProvider delayDuration={120}>
            <div className="space-y-4">
              <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                Configure regional/session controls with hidden <span className="font-medium">Hint</span> explainers for security posture and user impact.
              </div>

              <Card className="bg-neutral-700 border-gray-600">
                <CardHeader>
                  <CardTitle className="text-base">Regional Preferences</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-3 border-b border-gray-600">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Allow users to edit timezone"
                        hint={CONTROLS_FIELD_HELP.allowUserTimezoneEdit.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.allowUserTimezoneEdit.inline}</p>
                    </div>
                    <Switch
                      checked={Boolean(config.allowUserTimezoneEdit)}
                      onCheckedChange={(checked) => {
                        setConfig(prev => prev ? { ...prev, allowUserTimezoneEdit: checked } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-neutral-700 border-gray-600">
                <CardHeader>
                  <CardTitle className="text-base">Session & Device Security</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-3 border-b border-gray-600">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Enable Remember Me"
                        hint={CONTROLS_FIELD_HELP.rememberMeEnabled.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.rememberMeEnabled.inline}</p>
                    </div>
                    <Switch
                      checked={Boolean(config.rememberMeEnabled)}
                      onCheckedChange={(checked) => {
                        setConfig(prev => prev ? { ...prev, rememberMeEnabled: checked } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <FieldHintLabel label="Remember Me Max Age (days)" hint={CONTROLS_FIELD_HELP.rememberMeMaxAgeDays.tooltip} />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.rememberMeMaxAgeDays.inline}</p>
                      <Input
                        type="number"
                        min={1}
                        max={90}
                        value={Number(config.rememberMeMaxAgeDays ?? 30)}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setConfig(prev => prev ? { ...prev, rememberMeMaxAgeDays: value } : prev);
                          setConfigChanged(true);
                        }}
                        className="bg-neutral-600 mt-2"
                        title={CONTROLS_FIELD_HELP.rememberMeMaxAgeDays.tooltip}
                      />
                    </div>
                    <div>
                      <FieldHintLabel label="Max Devices Per User" hint={CONTROLS_FIELD_HELP.rememberMeMaxDevicesPerUser.tooltip} />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.rememberMeMaxDevicesPerUser.inline}</p>
                      <Input
                        type="number"
                        min={1}
                        max={25}
                        value={Number(config.rememberMeMaxDevicesPerUser ?? 10)}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setConfig(prev => prev ? { ...prev, rememberMeMaxDevicesPerUser: value } : prev);
                          setConfigChanged(true);
                        }}
                        className="bg-neutral-600 mt-2"
                        title={CONTROLS_FIELD_HELP.rememberMeMaxDevicesPerUser.tooltip}
                      />
                    </div>
                    <div>
                      <FieldHintLabel label="Re-auth After Absence (days)" hint={CONTROLS_FIELD_HELP.rememberMeReauthAfterAbsenceDays.tooltip} />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.rememberMeReauthAfterAbsenceDays.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={90}
                        value={Number(config.rememberMeReauthAfterAbsenceDays ?? 7)}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setConfig(prev => prev ? { ...prev, rememberMeReauthAfterAbsenceDays: value } : prev);
                          setConfigChanged(true);
                        }}
                        className="bg-neutral-600 mt-2"
                        title={CONTROLS_FIELD_HELP.rememberMeReauthAfterAbsenceDays.tooltip}
                      />
                    </div>
                    <div>
                      <FieldHintLabel label="Session Cookie Max Age (hours)" hint={CONTROLS_FIELD_HELP.sessionCookieMaxAgeHours.tooltip} />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.sessionCookieMaxAgeHours.inline}</p>
                      <Input
                        type="number"
                        min={1}
                        max={336}
                        value={Number(config.sessionCookieMaxAgeHours ?? 24)}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setConfig(prev => prev ? { ...prev, sessionCookieMaxAgeHours: value } : prev);
                          setConfigChanged(true);
                        }}
                        className="bg-neutral-600 mt-2"
                        title={CONTROLS_FIELD_HELP.sessionCookieMaxAgeHours.tooltip}
                      />
                    </div>
                    <div>
                      <FieldHintLabel label="Session Idle Timeout (minutes)" hint={CONTROLS_FIELD_HELP.sessionIdleTimeoutMinutes.tooltip} />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.sessionIdleTimeoutMinutes.inline}</p>
                      <Input
                        type="number"
                        min={0}
                        max={1440}
                        value={Number(config.sessionIdleTimeoutMinutes ?? 0)}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setConfig(prev => prev ? { ...prev, sessionIdleTimeoutMinutes: value } : prev);
                          setConfigChanged(true);
                        }}
                        className="bg-neutral-600 mt-2"
                        title={CONTROLS_FIELD_HELP.sessionIdleTimeoutMinutes.tooltip}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-3 border-t border-gray-600">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Rotate Remember Tokens on Use"
                        hint={CONTROLS_FIELD_HELP.rememberMeTokenRotationEnabled.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.rememberMeTokenRotationEnabled.inline}</p>
                    </div>
                    <Switch
                      checked={Boolean(config.rememberMeTokenRotationEnabled)}
                      onCheckedChange={(checked) => {
                        setConfig(prev => prev ? { ...prev, rememberMeTokenRotationEnabled: checked } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between py-3 border-t border-gray-600">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Auto-Revoke All on Theft Detection"
                        hint={CONTROLS_FIELD_HELP.rememberMeTheftAutoRevokeAll.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.rememberMeTheftAutoRevokeAll.inline}</p>
                    </div>
                    <Switch
                      checked={Boolean(config.rememberMeTheftAutoRevokeAll)}
                      onCheckedChange={(checked) => {
                        setConfig(prev => prev ? { ...prev, rememberMeTheftAutoRevokeAll: checked } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between py-3 border-t border-gray-600">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Logout Clears All Device Tokens"
                        hint={CONTROLS_FIELD_HELP.logoutClearAllDeviceTokens.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.logoutClearAllDeviceTokens.inline}</p>
                    </div>
                    <Switch
                      checked={Boolean(config.logoutClearAllDeviceTokens)}
                      onCheckedChange={(checked) => {
                        setConfig(prev => prev ? { ...prev, logoutClearAllDeviceTokens: checked } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-neutral-700 border-gray-600">
                <CardHeader>
                  <CardTitle className="text-base">Scout Access Control</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-3 border-b border-gray-600">
                    <div className="w-full">
                      <FieldHintLabel
                        label="Enable Scout tab"
                        hint={CONTROLS_FIELD_HELP.scoutTabEnabled.tooltip}
                        labelClassName="text-base font-medium"
                      />
                      <p className="text-xs text-gray-400 mt-1">{CONTROLS_FIELD_HELP.scoutTabEnabled.inline}</p>
                    </div>
                    <Switch
                      checked={Boolean(config.scoutTabEnabled)}
                      onCheckedChange={(checked) => {
                        setConfig(prev => prev ? { ...prev, scoutTabEnabled: checked } : prev);
                        setConfigChanged(true);
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSave}
                  disabled={!configChanged || updateMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </div>
          </TooltipProvider>
        </TabsContent>

        {/* MIGRATION */}
        <TabsContent value="migration">
          <MigrationTab />
        </TabsContent>

        {/* SYSTEM HEALTH */}
        <TabsContent value="health">
          <Card className="bg-neutral-700 border-gray-600">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">System Health Status</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchHealth()}
                className="bg-neutral-600 hover:bg-neutral-500"
                title={SYSTEM_HEALTH_FIELD_HELP.refresh.tooltip}
              >
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <TooltipProvider delayDuration={120}>
                <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                  Inspect market data provider readiness using hidden <span className="font-medium">Hint</span> explainers for probe behavior and diagnostics.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-3">
                    <FieldHintLabel label="Provider" hint={SYSTEM_HEALTH_FIELD_HELP.provider.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{SYSTEM_HEALTH_FIELD_HELP.provider.inline}</p>
                    <Select value={healthProviderKey} onValueChange={setHealthProviderKey}>
                      <SelectTrigger className="bg-neutral-600 mt-2" title={SYSTEM_HEALTH_FIELD_HELP.provider.tooltip}>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent className="bg-neutral-700">
                        {providers.map((p) => (
                          <SelectItem key={p.providerKey} value={p.providerKey}>
                            {p.displayName} ({p.providerKey})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-400 mt-1">
                      Active configured: <span className="font-mono">{health?.activeProviderKey ?? providersData?.activeKey ?? "—"}</span>{" "}
                      · Feed using: <span className="font-mono">{health?.feedProviderKey ?? health?.feedSource ?? "simulated"}</span>
                    </p>
                    {health?.requestedProvider?.missingSecrets?.length ? (
                      <p className="text-xs text-amber-300 mt-1">
                        Missing env secrets: <span className="font-mono">{health.requestedProvider.missingSecrets.join(", ")}</span>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => probeProviderMutation.mutate()}
                      disabled={probeProviderMutation.isPending || !healthProviderKey}
                      className="bg-neutral-600 hover:bg-neutral-500"
                      title={SYSTEM_HEALTH_FIELD_HELP.fetchStatus.tooltip}
                    >
                      {probeProviderMutation.isPending ? "Fetching…" : "Fetch Status"}
                    </Button>
                  </div>
                </div>

                {health ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-neutral-800 p-4 rounded-lg">
                      <div className="flex items-center mb-2">
                        <div
                          className={`w-3 h-3 rounded-full mr-2 ${healthProviderKey && health.feedProviderKey && healthProviderKey === health.feedProviderKey
                              ? (health.feedProviderConnected ? "bg-green-500" : "bg-red-500")
                              : healthProviderKey
                                ? (health.requestedProvider?.configUsable ? "bg-amber-500" : "bg-red-500")
                                : "bg-gray-500"
                            }`}
                        ></div>
                        <span className="font-medium">Provider Status</span>
                      </div>
                      <p
                        className={`text-lg ${healthProviderKey && health.feedProviderKey && healthProviderKey === health.feedProviderKey
                            ? (health.feedProviderConnected ? "text-green-400" : "text-red-400")
                            : healthProviderKey
                              ? (health.requestedProvider?.configUsable ? "text-amber-300" : "text-red-400")
                              : "text-gray-400"
                          }`}
                      >
                        {(() => {
                          if (!healthProviderKey) return "Select a provider";
                          const selectedIsFeed = Boolean(health.feedProviderKey && healthProviderKey === health.feedProviderKey);
                          if (selectedIsFeed) return health.feedProviderConnected ? "Connected" : "Disconnected";
                          if (health.requestedProvider?.error) return String(health.requestedProvider.error);
                          if (health.requestedProvider?.configUsable) return "Configured (not active)";
                          if (health.requestedProvider?.missingSecrets?.length) return "Missing API key";
                          return "Unknown";
                        })()}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Selected: <span className="font-mono">{healthProviderKey || "—"}</span>
                        {health.requestedProvider?.displayName ? (
                          <>
                            {" "}
                            · <span className="truncate">{health.requestedProvider.displayName}</span>
                          </>
                        ) : null}
                      </p>
                    </div>

                    <div className="bg-neutral-800 p-4 rounded-lg">
                      <div className="font-medium mb-2">Last Provider Success</div>
                      <p className="text-lg">
                        {health.lastProviderSuccessAt ? new Date(health.lastProviderSuccessAt).toLocaleString() : 'Never'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Provider: <span className="font-mono">{health.lastProviderSuccessKey ?? "—"}</span>
                      </p>
                    </div>

                    <div className="bg-neutral-800 p-4 rounded-lg">
                      <div className="font-medium mb-2">Consecutive Failures</div>
                      <p className={`text-lg ${health.failures > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                        {health.failures}
                      </p>
                    </div>

                    <div className="bg-neutral-800 p-4 rounded-lg">
                      <div className="font-medium mb-2">Feed Source</div>
                      <p className="text-lg font-mono">{health.feedSource ?? "—"}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {health.feedSourceAt ? new Date(health.feedSourceAt).toLocaleString() : "—"}
                      </p>
                    </div>

                    <div className="bg-neutral-800 p-4 rounded-lg">
                      <div className="font-medium mb-2">Stale Symbols</div>
                      <p className={`text-lg ${health.staleCount > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                        {health.staleCount}
                      </p>
                    </div>

                    <div className="bg-neutral-800 p-4 rounded-lg">
                      <div className="font-medium mb-2">Quote Cache Size</div>
                      <p className="text-lg">{health.cacheSize} symbols</p>
                    </div>

                    <div className="bg-neutral-800 p-4 rounded-lg">
                      <div className="font-medium mb-2">Server Time</div>
                      <p className="text-lg">
                        {new Date(health.serverTime).toLocaleString()}
                      </p>
                    </div>

                    <div className="bg-neutral-800 p-4 rounded-lg">
                      <div className="font-medium mb-2">Last Feed Update</div>
                      <p className="text-lg">
                        {health.lastSuccess ? new Date(health.lastSuccess).toLocaleString() : "Never"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-400">Loading health data...</p>
                )}
              </TooltipProvider>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ open: false, key: "", value: false, label: "" })}>
        <AlertDialogContent className="bg-neutral-800 border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {confirmDialog.label}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {confirmDialog.value ? 'enable' : 'disable'} <strong>{confirmDialog.label}</strong>?
              {confirmDialog.key === "tradingHalt" && " This will immediately block all new trades platform-wide."}
              {confirmDialog.key === "maintenanceMode" && " This will show a maintenance banner and block trading for non-admins."}
              {confirmDialog.key === "closeOnlyMode" && " This will prevent users from opening new positions."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-neutral-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggle} className="bg-red-600 hover:bg-red-700">
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UserSettings>({
    userId: 0,
    leverage: 50,
    maxConcurrent: 5,
    maxConcurrentPerInstrument: null,
    maxConcurrentLots: 50,
    minHoldSec: 60,
    maxHoldSec: 86400,
    showOnLeaderboard: true
  });
  const [activeTab, setActiveTab] = useState("users");
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Enhanced user management state
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [userFilterTab, setUserFilterTab] = useState<"all" | "active" | "disabled" | "frozen" | "online" | "logins" | "audit" | "kyc" | "grift" | "activity">("all");
  const [policyConfig, setPolicyConfig] = useState<PolicyConfigData | null>(null);
  const [policyConfigChanged, setPolicyConfigChanged] = useState(false);
  const [timelineDialogOpen, setTimelineDialogOpen] = useState(false);
  const [timelineUser, setTimelineUser] = useState<User | null>(null);
  const [freezeDialogOpen, setFreezeDialogOpen] = useState(false);
  const [freezeUser, setFreezeUser] = useState<User | null>(null);
  const [freezeReason, setFreezeReason] = useState({ code: "", text: "" });
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notesUser, setNotesUser] = useState<User | null>(null);
  const [newNote, setNewNote] = useState({ type: "NOTE" as "NOTE" | "FLAG", severity: "INFO" as "INFO" | "WARN" | "HIGH" | "CRITICAL", content: "", flagCode: "" });

  // Grift drilldown state
  const [griftDrilldownUserId, setGriftDrilldownUserId] = useState<number | null>(null);

  // Column visibility state for responsive design
  const [visibleColumns, setVisibleColumns] = useState<Record<UserColumnKey, boolean>>({
    name: false,
    phone: false,
    username: false,
    email: true,
    status: true,
    balance: true,
    leverage: true,
    maxTrades: true,
    minHold: false,
    maxHold: false,
    leaderboard: true,
  });

  // Column search filters
  const [columnFilters, setColumnFilters] = useState({
    name: '',
    phone: '',
    username: '',
    email: '',
  });

  // Audit trail filter state
  const [auditEventFilter, setAuditEventFilter] = useState<"all" | "signup" | "login_success" | "login_fail" | "admin">("all");

  // Symbol management state
  const [editingSymbol, setEditingSymbol] = useState<SymbolConfig | null>(null);
  const [symbolDialogOpen, setSymbolDialogOpen] = useState(false);
  const [newSymbolDialogOpen, setNewSymbolDialogOpen] = useState(false);
  const [catalogEnableDialogOpen, setCatalogEnableDialogOpen] = useState(false);
  const [newSymbol, setNewSymbol] = useState<Partial<SymbolConfig>>({
    symbol: '',
    name: '',
    category: 'forex',
    baseCurrency: '',
    quoteCurrency: '',
    spread: 0,
    minSpreadPips: 2,
    pipDecimals: null,
    quoteDecimals: null,
    enabled: true,
    minLot: 1,
    maxLot: 50
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [symbolToDelete, setSymbolToDelete] = useState<number | null>(null);
  const [instrumentsSubTab, setInstrumentsSubTab] = useState<"configured" | "ingestor" | "quoteSubscriptions">("configured");

  // Global settings state (includes all Trade Settings tab values)
  const [riskParams, setRiskParams] = useState<GlobalSettings>({
    id: 1,
    defaultLeverage: 50,
    maxPositionSize: 100000,
    maxTradesPerUser: 10,
    maxTradesPerInstrument: 3,
    maxConcurrentLots: 50,
    minPriceDistancePips: 20,
    marketOpenTime: "09:00",
    marketCloseTime: "17:00",
    allowWeekendTrading: false,
    enableAutoClose: true,
    autoCloseAfterDays: 4,
    autoCloseCheckFrequencyMinutes: 60,
    minHoldSec: 60,
    enableLossLimits: true,
    dailyLossLimitPct: 10,
    lifetimeLossLimitPct: 20,
    defaultUserStartingBalanceUsd: 1000000,
    defaultUserStartingEquityUsd: 1000000,
    defaultChallengeVirtualCapitalUsd: 100000,
    lotPresetCards: "[1,5,10,25,50]",
    lotDropdownMax: 50,
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
    updatedAt: null
  });
  const [riskParamsChanged, setRiskParamsChanged] = useState(false);

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => axios.get("/api/admin/users").then(r => r.data),
  });

  const { data: symbols = [], isLoading: isLoadingSymbols } = useQuery<SymbolConfig[]>({
    queryKey: ["/api/admin/symbols"],
    queryFn: () => axios.get("/api/admin/symbols").then(r => r.data),
  });

  // Fetch global settings
  const { data: globalSettingsData } = useQuery<GlobalSettings>({
    queryKey: ["/api/admin/global-settings"],
    queryFn: () => axios.get("/api/admin/global-settings").then(r => r.data),
  });

  const { data: scoutTabConfig } = useQuery<Pick<SystemConfigData, "scoutTabEnabled">>({
    queryKey: ["/api/admin/system-config", "tab-visibility"],
    queryFn: () => axios.get("/api/admin/system-config").then((r) => r.data),
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const scoutTabVisible = Boolean(scoutTabConfig?.scoutTabEnabled ?? true);

  useEffect(() => {
    if (!scoutTabVisible && activeTab === "scout") {
      setActiveTab("users");
    }
  }, [activeTab, scoutTabVisible]);

  // Sync global settings to local state when data is fetched (only when not editing)
  useEffect(() => {
    if (globalSettingsData && !riskParamsChanged) {
      setRiskParams((prev) => {
        const raw = Number((globalSettingsData as any)?.minPriceDistancePips);
        const minPriceDistancePips = Number.isFinite(raw) ? Math.trunc(raw) : (prev.minPriceDistancePips ?? 20);
        return { ...prev, ...globalSettingsData, minPriceDistancePips };
      });
    }
  }, [globalSettingsData, riskParamsChanged]);

  const mutation = useMutation({
    mutationFn: (payload: UserSettings) =>
      axios.post(`/api/admin/users/${payload.userId}/settings`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditDialogOpen(false);
      setEditingUser(null);
      toast({ title: "User settings saved", description: "Trading parameters updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to save user settings", variant: "destructive" });
    },
  });

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      userId: user.id,
      leverage: user.leverage || 50,
      maxConcurrent: user.maxConcurrent || 5,
      maxConcurrentPerInstrument: user.maxConcurrentPerInstrument ?? null,
      maxConcurrentLots: user.maxConcurrentLots || 50,
      minHoldSec: user.minHoldSec || 60,
      maxHoldSec: user.maxHoldSec || 86400,
      showOnLeaderboard: user.showOnLeaderboard !== false,
      balance: user.balance
    });
    setEditDialogOpen(true);
  };

  const handleSave = () => {
    mutation.mutate(editForm);
  };

  const handleChange = (name: string, value: any) => {
    setEditForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleBalanceUpdate = useMutation({
    mutationFn: (data: { userId: number, balance: string }) =>
      axios.post(`/api/admin/users/${data.userId}/balance`, { balance: data.balance }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Balance updated", description: "User balance updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to update balance", variant: "destructive" });
    },
  });

  const updateBalance = (userId: number, newBalance: string) => {
    handleBalanceUpdate.mutate({ userId, balance: newBalance });
  };

  // Enhanced user management queries
  const { data: userTimeline = [], refetch: refetchTimeline } = useQuery<TimelineEvent[]>({
    queryKey: ["/api/admin/users", timelineUser?.id, "timeline"],
    queryFn: () => axios.get(`/api/admin/users/${timelineUser?.id}/timeline`).then(r => r.data),
    enabled: !!timelineUser && timelineDialogOpen,
  });

  const { data: userNotes = [], refetch: refetchNotes } = useQuery<AdminNote[]>({
    queryKey: ["/api/admin/users", notesUser?.id, "notes"],
    queryFn: () => axios.get(`/api/admin/users/${notesUser?.id}/notes`).then(r => r.data),
    enabled: !!notesUser && notesDialogOpen,
  });

  // Enhanced user management mutations
  const toggleUserStatusMutation = useMutation({
    mutationFn: (data: { userId: number; disabled: boolean }) =>
      axios.post(`/api/admin/users/${data.userId}/toggle-status`, { disabled: data.disabled }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: variables.disabled ? "User disabled" : "User enabled", description: "Account status updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to update user status", variant: "destructive" });
    },
  });

  const freezeUserMutation = useMutation({
    mutationFn: (data: { userId: number; reasonCode: string; reasonText?: string }) =>
      axios.post(`/api/admin/users/${data.userId}/freeze`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setFreezeDialogOpen(false);
      setFreezeUser(null);
      setFreezeReason({ code: "", text: "" });
      toast({ title: "Account frozen", description: "User account has been frozen successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to freeze account", variant: "destructive" });
    },
  });

  const unfreezeUserMutation = useMutation({
    mutationFn: (userId: number) => axios.post(`/api/admin/users/${userId}/unfreeze`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Account unfrozen", description: "User account access has been restored" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to unfreeze account", variant: "destructive" });
    },
  });

  const viewAsMutation = useMutation({
    mutationFn: (userId: number) => axios.post(`/api/admin/view-as/start`, { userId }),
    onSuccess: () => {
      toast({ title: "View As started", description: "Now viewing as selected user" });
      window.location.href = "/"; // Redirect to dashboard as the impersonated user
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to start impersonation", variant: "destructive" });
    },
  });

  // KYC status update mutation
  const updateKycStatusMutation = useMutation({
    mutationFn: (data: { userId: number; status: string; notes?: string }) =>
      axios.post(`/api/admin/users/${data.userId}/kyc-status`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kyc-queue"] });
      toast({
        title: variables.status === 'APPROVED' ? "KYC Approved" : "KYC Rejected",
        description: `User KYC status has been updated to ${variables.status}`
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to update KYC status", variant: "destructive" });
    },
  });

  const inviteKycMutation = useMutation({
    mutationFn: (data: { userId: number; note?: string }) =>
      axios.post("/api/admin/kyc/invite", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kyc-queue"] });
      toast({ title: "KYC invitation sent" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to send KYC invite", variant: "destructive" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: (data: { userId: number; type: string; severity: string; content: string; flagCode?: string }) =>
      axios.post(`/api/admin/users/${data.userId}/notes`, data),
    onSuccess: () => {
      refetchNotes();
      setNewNote({ type: "NOTE", severity: "INFO", content: "", flagCode: "" });
      toast({ title: "Note added", description: "Admin note saved successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to add note", variant: "destructive" });
    },
  });

  const resolveNoteMutation = useMutation({
    mutationFn: (noteId: number) => axios.post(`/api/admin/notes/${noteId}/resolve`),
    onSuccess: () => {
      refetchNotes();
      toast({ title: "Note resolved", description: "Admin note marked as resolved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to resolve note", variant: "destructive" });
    },
  });

  const bulkToggleStatusMutation = useMutation({
    mutationFn: (data: { userIds: number[]; disabled: boolean }) =>
      axios.post(`/api/admin/users/bulk/toggle-status`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUserIds([]);
      toast({
        title: variables.disabled ? "Users disabled" : "Users enabled",
        description: `${variables.userIds.length} account(s) updated successfully`
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to update users", variant: "destructive" });
    },
  });

  // User management handlers
  const handleSelectUser = (userId: number, selected: boolean) => {
    if (selected) {
      setSelectedUserIds(prev => [...prev, userId]);
    } else {
      setSelectedUserIds(prev => prev.filter(id => id !== userId));
    }
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedUserIds(filteredUsers.map(u => u.id));
    } else {
      setSelectedUserIds([]);
    }
  };

  const openTimeline = (user: User) => {
    setTimelineUser(user);
    setTimelineDialogOpen(true);
  };

  const openFreeze = (user: User) => {
    setFreezeUser(user);
    setFreezeDialogOpen(true);
  };

  const openNotes = (user: User) => {
    setNotesUser(user);
    setNotesDialogOpen(true);
  };

  const exportUsers = () => {
    window.open('/api/admin/export/users', '_blank');
  };

  const exportUsersJsonl = () => {
    window.open('/api/admin/export/users/jsonl', '_blank');
  };

  // Login history query for Login History tab
  const { data: allLoginHistory = [], isLoading: isLoadingLoginHistory } = useQuery<LoginHistoryEntry[]>({
    queryKey: ["/api/admin/login-history"],
    queryFn: () => axios.get("/api/admin/login-history").then(r => r.data),
    enabled: userFilterTab === "logins",
  });

  // Audit trail query for combined audit events (signups, logins, admin actions)
  const { data: auditTrailData, isLoading: isLoadingAuditTrail } = useQuery<{
    signups: Array<{ id: number; email: string; username: string; createdAt: number }>;
    logins: Array<{ id: number; email: string; success: boolean; ip: string | null; createdAt: number }>;
    adminActions: Array<{ id: number; adminId: number; userId: number; actionType: string; createdAt: number; metadata?: string }>;
  }>({
    queryKey: ["/api/admin/audit-trail"],
    queryFn: () => axios.get("/api/admin/audit-trail").then(r => r.data),
    enabled: userFilterTab === "audit",
  });

  // KYC Queue query for contender candidates (policy-backed)
  const { data: kycQueueData, isLoading: isLoadingKycQueue } = useQuery<{ candidates: KycCandidate[] }>({
    queryKey: ["/api/admin/kyc-queue"],
    queryFn: () => axios.get("/api/admin/kyc-queue").then(r => r.data),
    enabled: userFilterTab === "kyc",
  });

  const { data: policyConfigData, isLoading: isLoadingPolicyConfig } = useQuery<{
    config: PolicyConfigData;
  }>({
    queryKey: ["/api/admin/system-config/policy"],
    queryFn: () => axios.get("/api/admin/system-config/policy").then(r => r.data),
    enabled: userFilterTab === "kyc",
  });

  useEffect(() => {
    if (policyConfigData?.config && !policyConfigChanged) {
      setPolicyConfig(policyConfigData.config);
    }
  }, [policyConfigData, policyConfigChanged]);

  const policyConfigMutation = useMutation({
    mutationFn: (payload: PolicyConfigData) => axios.post("/api/admin/system-config/policy", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-config/policy"] });
      toast({ title: "Policy config updated" });
      setPolicyConfigChanged(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.error || "Failed to update policy config", variant: "destructive" });
    },
  });

  const kycCandidates = kycQueueData?.candidates ?? [];
  const policySummary = policyConfig ?? policyConfigData?.config ?? null;
  const path2WindowDays = policySummary?.policyContenderPath2MinAgeDays ?? 90;

  // Grift Detection summary query
  const { data: griftSummary, isLoading: isLoadingGriftSummary } = useQuery<{
    openAlerts: number;
    highRiskUsers: number;
    linkedClusters: number;
    tierCounts?: { low: number; medium: number; high: number; critical: number };
  }>({
    queryKey: ["/api/admin/grift/summary"],
    queryFn: () => axios.get("/api/admin/grift/summary").then(r => r.data),
    enabled: userFilterTab === "grift",
  });

  // Grift config query for admin-editable thresholds
  const { data: griftConfigData, isLoading: isLoadingGriftConfig } = useQuery<{
    config: {
      multiAccountWindowDays: number;
      churnWindowHours: number;
      hedgeWindowMinutes: number;
      ipUniqueThreshold: number;
      uaUniqueThreshold: number;
      deviceUniqueThreshold: number;
      geoVelocityKmhThreshold: number;
      geoVelocityMinDistanceKm: number;
      geoVelocityMaxHours: number;
      tierLow: number;
      tierMedium: number;
      tierHigh: number;
      scoreMultiAccountDevice: number;
      scoreCoordinatedHedge: number;
      scoreImpossibleTravel: number;
      scoreIpChurn: number;
      scoreUaChurn: number;
      scoreDeviceChurn: number;
    };
  }>({
    queryKey: ["/api/admin/grift/config"],
    queryFn: () => axios.get("/api/admin/grift/config").then(r => r.data),
    enabled: userFilterTab === "grift",
  });

  // Grift flagged users query
  const { data: griftFlaggedUsers = [], isLoading: isLoadingGriftUsers } = useQuery<Array<{
    user_id: number;
    risk_score: number;
    risk_factors_json: string;
    last_evaluated_at: number;
    email?: string;
    username?: string;
  }>>({
    queryKey: ["/api/admin/grift/flagged-users"],
    queryFn: () => axios.get("/api/admin/grift/flagged-users").then(r => r.data?.users || []),
    enabled: userFilterTab === "grift",
  });

  // Grift alerts query
  const { data: griftAlerts = [], isLoading: isLoadingGriftAlerts } = useQuery<Array<{
    id: number;
    user_id: number;
    rule_type: string;
    severity: string;
    score: number;
    status: string;
    details_json: string;
    related_user_id: number | null;
    created_at: number;
  }>>({
    queryKey: ["/api/admin/grift/alerts"],
    queryFn: () => axios.get("/api/admin/grift/alerts").then(r => r.data?.alerts || []),
    enabled: userFilterTab === "grift",
  });

  // Grift drilldown profile query
  const { data: griftDrilldownData, isLoading: isLoadingGriftDrilldown } = useQuery<{
    userId: number;
    risk: { risk_score: number; risk_tier: string; risk_factors_json: string };
    linkedAccounts: Array<{ id: number; email: string; username?: string }>;
    alerts: Array<{ id: number; rule_type: string; severity: string; score: number; created_at: number }>;
    signals: Array<{ id: number; rule_code: string; score: number; status: string; created_at: number; evidence_json: string; related_user_id?: number }>;
    sessions: Array<{ id: number; ip: string; device_fp: string; device_install_id: string; country_code: string; city: string; login_time: number }>;
    devices: Array<{ device_fp: string; device_install_id: string; session_count: number; first_seen: number; last_seen: number }>;
    ips: Array<{ ip: string; country_code: string; city: string; session_count: number; first_seen: number; last_seen: number }>;
    enforcement?: { frozen_at?: number; disabled_at?: number; notes?: string };
  }>({
    queryKey: ["/api/admin/users", griftDrilldownUserId, "grift-profile"],
    queryFn: () => axios.get(`/api/admin/users/${griftDrilldownUserId}/grift-profile`).then(r => r.data),
    enabled: !!griftDrilldownUserId,
  });

  // Grift cases query
  const { data: griftCases = [], isLoading: isLoadingGriftCases } = useQuery<Array<{
    id: number;
    title: string;
    status: string;
    priority: string;
    created_by_admin_id: number;
    assigned_admin_id?: number;
    resolution?: string;
    created_at: number;
    closed_at?: number;
  }>>({
    queryKey: ["/api/admin/grift/cases"],
    queryFn: () => axios.get("/api/admin/grift/cases").then(r => r.data?.cases || []),
    enabled: userFilterTab === "grift",
  });

  // Grift audit log query
  const { data: griftAuditLog = [], isLoading: isLoadingGriftAudit } = useQuery<Array<{
    id: number;
    admin_user_id: number;
    action_type: string;
    target_user_id?: number;
    target_signal_id?: number;
    details_json?: string;
    hash?: string;
    created_at: number;
  }>>({
    queryKey: ["/api/admin/grift/audit-log"],
    queryFn: () => axios.get("/api/admin/grift/audit-log?limit=50").then(r => r.data?.entries || []),
    enabled: userFilterTab === "grift",
  });

  // Grift signal lifecycle mutations
  const signalReviewMutation = useMutation({
    mutationFn: (signalId: number) => axios.post(`/api/admin/grift/signals/${signalId}/review`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", griftDrilldownUserId, "grift-profile"] });
      toast({ title: "Signal marked as In Review" });
    },
  });

  const signalIgnoreMutation = useMutation({
    mutationFn: ({ signalId, reason }: { signalId: number; reason?: string }) =>
      axios.post(`/api/admin/grift/signals/${signalId}/ignore`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", griftDrilldownUserId, "grift-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/summary"] });
      toast({ title: "Signal ignored" });
    },
  });

  const signalCloseMutation = useMutation({
    mutationFn: ({ signalId, reason }: { signalId: number; reason?: string }) =>
      axios.post(`/api/admin/grift/signals/${signalId}/close`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", griftDrilldownUserId, "grift-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/summary"] });
      toast({ title: "Signal closed" });
    },
  });

  // Grift enforcement mutations
  const griftFreezeMutation = useMutation({
    mutationFn: ({ userId, notes }: { userId: number; notes?: string }) =>
      axios.post(`/api/admin/users/${userId}/grift/freeze`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", griftDrilldownUserId, "grift-profile"] });
      toast({ title: "User account frozen" });
    },
  });

  const griftUnfreezeMutation = useMutation({
    mutationFn: ({ userId }: { userId: number }) => axios.post(`/api/admin/users/${userId}/grift/unfreeze`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", griftDrilldownUserId, "grift-profile"] });
      toast({ title: "User account unfrozen" });
    },
  });

  const griftDisableMutation = useMutation({
    mutationFn: ({ userId, notes }: { userId: number; notes?: string }) =>
      axios.post(`/api/admin/users/${userId}/grift/disable`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", griftDrilldownUserId, "grift-profile"] });
      toast({ title: "User account disabled" });
    },
  });

  const griftEnableMutation = useMutation({
    mutationFn: ({ userId }: { userId: number }) => axios.post(`/api/admin/users/${userId}/grift/enable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", griftDrilldownUserId, "grift-profile"] });
      toast({ title: "User account re-enabled" });
    },
  });

  // Grift config update mutation
  const griftConfigMutation = useMutation({
    mutationFn: (config: Record<string, number>) => axios.put("/api/admin/grift/config", config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/config"] });
      toast({ title: "Detection config updated" });
      setIsEditingGriftConfig(false);
    },
  });

  // Config editing state
  const [isEditingGriftConfig, setIsEditingGriftConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState<Record<string, number>>({});

  // Online users query
  const { data: onlineData, isLoading: isLoadingOnline } = useQuery<{
    onlineCount: number;
    offlineCount: number;
    onlineUsers: Array<{
      id: number;
      userId: number;
      email: string;
      username: string | null;
      name: string | null;
      ip: string | null;
      loginTime: string;
      sessionDuration: number;
    }>;
  }>({
    queryKey: ["/api/admin/online-users"],
    queryFn: () => axios.get("/api/admin/online-users").then(r => r.data),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Filter users based on selected tab
  const filteredUsers = users.filter(user => {
    // Status filter - Disabled tab takes priority (disabled users show there even if also frozen)
    let statusMatch = true;
    switch (userFilterTab) {
      case "active":
        statusMatch = !user.isDisabled && !user.isFrozen;
        break;
      case "disabled":
        // Show all disabled users (including those that are also frozen)
        statusMatch = user.isDisabled === true;
        break;
      case "frozen":
        // Only show frozen users who are NOT disabled (frozen+disabled go to Disabled tab)
        statusMatch = user.isFrozen === true && !user.isDisabled;
        break;
    }
    if (!statusMatch) return false;

    // Column search filters
    if (columnFilters.name && !(user.name || '').toLowerCase().includes(columnFilters.name.toLowerCase())) return false;
    if (columnFilters.phone && !(user.phone || '').toLowerCase().includes(columnFilters.phone.toLowerCase())) return false;
    if (columnFilters.username && !user.username.toLowerCase().includes(columnFilters.username.toLowerCase())) return false;
    if (columnFilters.email && !user.email.toLowerCase().includes(columnFilters.email.toLowerCase())) return false;

    return true;
  });

  // Symbol management mutations
  const symbolUpdateMutation = useMutation({
    mutationFn: (payload: SymbolConfig) =>
      axios.put(`/api/admin/symbols/${payload.id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/symbols"] });
      setSymbolDialogOpen(false);
      setEditingSymbol(null);
      toast({ title: "Symbol saved", description: "Trading instrument updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to save symbol", variant: "destructive" });
    },
  });

  const newSymbolMutation = useMutation({
    mutationFn: (payload: Partial<SymbolConfig>) =>
      axios.post('/api/admin/symbols', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/symbols"] });
      setNewSymbolDialogOpen(false);
      setNewSymbol({
        symbol: '',
        name: '',
        baseCurrency: '',
        quoteCurrency: '',
        spread: 0,
        minSpreadPips: 2,
        enabled: true,
        minLot: 1,
        maxLot: 50
      });
      toast({ title: "Symbol added", description: "New trading instrument created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to add symbol", variant: "destructive" });
    },
  });

  const deleteSymbolMutation = useMutation({
    mutationFn: (symbolId: number) =>
      axios.delete(`/api/admin/symbols/${symbolId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/symbols"] });
      setDeleteConfirmOpen(false);
      setSymbolToDelete(null);
      toast({ title: "Symbol deleted", description: "Trading instrument removed successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to delete symbol", variant: "destructive" });
    },
  });

  // Global settings mutation
  const globalSettingsMutation = useMutation({
    mutationFn: (payload: Partial<GlobalSettings>) =>
      axios.put('/api/admin/global-settings', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/global-settings"] });
      setRiskParamsChanged(false);
      toast({ title: "Risk settings saved", description: "Global trading parameters updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to save risk settings", variant: "destructive" });
    },
  });

  const handleRiskParamChange = (field: keyof GlobalSettings, value: number | string | boolean) => {
    setRiskParams(prev => ({ ...prev, [field]: value }));
    setRiskParamsChanged(true);
  };

  const handleSaveRiskParams = () => {
    globalSettingsMutation.mutate({
      defaultLeverage: riskParams.defaultLeverage,
      maxPositionSize: riskParams.maxPositionSize,
      maxTradesPerUser: riskParams.maxTradesPerUser,
      maxTradesPerInstrument: riskParams.maxTradesPerInstrument,
      maxConcurrentLots: riskParams.maxConcurrentLots,
      minPriceDistancePips: riskParams.minPriceDistancePips,
      marketOpenTime: riskParams.marketOpenTime,
      marketCloseTime: riskParams.marketCloseTime,
      allowWeekendTrading: riskParams.allowWeekendTrading,
      enableAutoClose: riskParams.enableAutoClose,
      autoCloseAfterDays: riskParams.autoCloseAfterDays,
      autoCloseCheckFrequencyMinutes: riskParams.autoCloseCheckFrequencyMinutes,
      minHoldSec: riskParams.minHoldSec,
      enableLossLimits: riskParams.enableLossLimits,
      dailyLossLimitPct: riskParams.dailyLossLimitPct,
      lifetimeLossLimitPct: riskParams.lifetimeLossLimitPct,
      defaultUserStartingBalanceUsd: riskParams.defaultUserStartingBalanceUsd,
      defaultUserStartingEquityUsd: riskParams.defaultUserStartingEquityUsd,
      defaultChallengeVirtualCapitalUsd: riskParams.defaultChallengeVirtualCapitalUsd,
      lotPresetCards: riskParams.lotPresetCards,
      lotDropdownMax: riskParams.lotDropdownMax,
    });
  };

  const handleEditSymbol = (symbol: SymbolConfig) => {
    setEditingSymbol(symbol);
    setSymbolDialogOpen(true);
  };

  const handleSymbolSave = () => {
    if (editingSymbol) {
      // Create a clean copy of the symbol data without the createdAt timestamp
      // to avoid date conversion issues
      const symbolData = {
        id: editingSymbol.id,
        symbol: editingSymbol.symbol,
        name: editingSymbol.name,
        category: editingSymbol.category ?? null,
        baseCurrency: editingSymbol.baseCurrency,
        quoteCurrency: editingSymbol.quoteCurrency,
        spread: editingSymbol.spread,
        minSpreadPips: editingSymbol.minSpreadPips,
        pipDecimals: editingSymbol.pipDecimals ?? null,
        quoteDecimals: editingSymbol.quoteDecimals ?? null,
        enabled: editingSymbol.enabled,
        minLot: editingSymbol.minLot,
        maxLot: editingSymbol.maxLot
      };

      symbolUpdateMutation.mutate(symbolData as SymbolConfig);
    }
  };

  const handleSymbolChange = (name: string, value: any) => {
    if (editingSymbol) {
      setEditingSymbol(prev => ({
        ...prev!,
        [name]: value
      }));
    }
  };

  const handleNewSymbolChange = (name: string, value: any) => {
    setNewSymbol(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleNewSymbolSave = () => {
    newSymbolMutation.mutate(newSymbol);
  };

  const confirmDeleteSymbol = (symbolId: number) => {
    setSymbolToDelete(symbolId);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteSymbol = () => {
    if (symbolToDelete !== null) {
      deleteSymbolMutation.mutate(symbolToDelete);
    }
  };

  return (
    <div className="page-pad bg-neutral-900 text-white min-h-screen min-h-dvh">
      <Card className="border-gray-800 bg-neutral-800 text-white">
        <CardHeader className="border-b border-gray-700">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Admin Dashboard</CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="border-neutral-600"
              onClick={() => {
                window.location.href = "/partner";
              }}
            >
              Partner Portal
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs defaultValue="users" value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="flex w-full bg-neutral-700 rounded-none h-auto p-1 gap-0.5 overflow-x-auto">
              <TabsTrigger value="users" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-blue-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                <span className="hidden md:inline">User Management</span>
                <span className="md:hidden">Users</span>
              </TabsTrigger>
              <TabsTrigger value="view-as" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-purple-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                <span className="hidden md:inline">View as Trader</span>
                <span className="md:hidden">View As</span>
              </TabsTrigger>
              <TabsTrigger value="trades" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-indigo-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                <span className="hidden md:inline">Trade Settings</span>
                <span className="md:hidden">Trades</span>
              </TabsTrigger>
              <TabsTrigger value="instruments" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-emerald-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                <span className="hidden md:inline">Instruments</span>
                <span className="md:hidden">Instr</span>
              </TabsTrigger>
              <TabsTrigger value="data" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-teal-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">Data</TabsTrigger>
              <TabsTrigger value="audit" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-amber-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                <span className="hidden md:inline">Trade Audit</span>
                <span className="md:hidden">Audit</span>
              </TabsTrigger>
              <TabsTrigger value="communications" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-cyan-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                <span className="hidden md:inline">Communications</span>
                <span className="md:hidden">Comms</span>
              </TabsTrigger>
              {scoutTabVisible && (
                <TabsTrigger value="scout" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-orange-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                  Scout
                </TabsTrigger>
              )}
              <TabsTrigger value="system" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-slate-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                <span className="hidden md:inline">System Config</span>
                <span className="md:hidden">Config</span>
              </TabsTrigger>
              <TabsTrigger value="legal" className="shrink-0 text-[10px] sm:text-xs md:text-sm data-[state=active]:bg-rose-600/60 data-[state=active]:text-white px-1.5 sm:px-2 py-1.5">
                Legal
              </TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="p-2 sm:p-4">
              <TooltipProvider delayDuration={120}>
                <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
                  <div>
                    <FieldHintLabel
                      label="User Management"
                      hint={USER_MANAGEMENT_FIELD_HELP.overview.tooltip}
                      labelClassName="text-lg sm:text-xl font-semibold"
                    />
                    <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.overview.inline}</p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      onClick={exportUsers}
                      variant="csv"
                      size="sm"
                      className="text-xs sm:text-sm"
                      title={USER_MANAGEMENT_FIELD_HELP.exportCsv.tooltip}
                    >
                      Export CSV
                    </Button>
                    <Button
                      onClick={exportUsersJsonl}
                      variant="jsonl"
                      size="sm"
                      className="text-xs sm:text-sm"
                      title={USER_MANAGEMENT_FIELD_HELP.exportJsonl.tooltip}
                    >
                      Export JSONL
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-4">
                  User management controls include hidden <span className="font-medium">Hint</span> explainers for tab intent, bulk actions, and sensitive account operations.
                </div>

                <div className="mb-2">
                  <FieldHintLabel label="User Mini-tabs" hint={USER_MANAGEMENT_FIELD_HELP.miniTabs.tooltip} />
                  <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.miniTabs.inline}</p>
                </div>

                {/* Mini-tabs for filtering */}
                <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-4 p-1 bg-neutral-700 rounded">
                  <button
                    onClick={() => { setUserFilterTab("all"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "all" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabAll.tooltip}
                  >
                    All ({users.length})
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("active"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "active" ? "bg-green-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabActive.tooltip}
                  >
                    Active ({users.filter(u => !u.isDisabled && !u.isFrozen).length})
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("disabled"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "disabled" ? "bg-red-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabDisabled.tooltip}
                  >
                    Disabled ({users.filter(u => u.isDisabled).length})
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("frozen"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "frozen" ? "bg-blue-500 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabFrozen.tooltip}
                  >
                    Frozen ({users.filter(u => u.isFrozen && !u.isDisabled).length})
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("online"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "online" ? "bg-cyan-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabOnline.tooltip}
                  >
                    <span className="hidden sm:inline">Online ({onlineData?.onlineCount || 0}) / Offline ({onlineData?.offlineCount || 0})</span>
                    <span className="sm:hidden">On/Off ({onlineData?.onlineCount || 0}/{onlineData?.offlineCount || 0})</span>
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("logins"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "logins" ? "bg-purple-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabLogins.tooltip}
                  >
                    <span className="hidden sm:inline">Login History</span>
                    <span className="sm:hidden">Logins</span>
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("audit"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "audit" ? "bg-orange-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabAudit.tooltip}
                  >
                    <span className="hidden sm:inline">Audit Trail</span>
                    <span className="sm:hidden">Audit</span>
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("kyc"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "kyc" ? "bg-teal-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabKyc.tooltip}
                  >
                    KYC Queue
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("grift"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "grift" ? "bg-red-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabGrift.tooltip}
                  >
                    <span className="hidden sm:inline">Grift Detection ({griftSummary?.openAlerts || 0})</span>
                    <span className="sm:hidden">Grift ({griftSummary?.openAlerts || 0})</span>
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("activity"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "activity" ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabActivity.tooltip}
                  >
                    Activity
                  </button>
                </div>

                {userFilterTab !== "logins" && userFilterTab !== "online" && userFilterTab !== "audit" && userFilterTab !== "kyc" && userFilterTab !== "grift" && userFilterTab !== "activity" && selectedUserIds.length > 0 && (
                  <div className="bg-neutral-700 p-3 rounded mb-4 flex items-center gap-4 flex-wrap">
                    <div className="w-full">
                      <FieldHintLabel label="Bulk User Actions" hint={USER_MANAGEMENT_FIELD_HELP.bulkActions.tooltip} />
                      <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.bulkActions.inline}</p>
                    </div>
                    <span className="text-sm" title={USER_MANAGEMENT_FIELD_HELP.bulkActions.tooltip}>{selectedUserIds.length} user(s) selected</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkToggleStatusMutation.isPending}
                      onClick={() => bulkToggleStatusMutation.mutate({ userIds: selectedUserIds, disabled: true })}
                      className="bg-amber-600 hover:bg-amber-700 border-0"
                      title={USER_MANAGEMENT_FIELD_HELP.disableSelectedAction.tooltip}
                    >
                      {bulkToggleStatusMutation.isPending ? 'Processing...' : 'Disable Selected'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkToggleStatusMutation.isPending}
                      onClick={() => bulkToggleStatusMutation.mutate({ userIds: selectedUserIds, disabled: false })}
                      className="bg-green-600 hover:bg-green-700 border-0"
                      title={USER_MANAGEMENT_FIELD_HELP.enableSelectedAction.tooltip}
                    >
                      {bulkToggleStatusMutation.isPending ? 'Processing...' : 'Enable Selected'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedUserIds([])} title={USER_MANAGEMENT_FIELD_HELP.clearSelectionAction.tooltip}>
                      Clear Selection
                    </Button>
                  </div>
                )}

                {userFilterTab === "online" ? (
                  /* Online Users View */
                  <div className="overflow-x-auto">
                    {isLoadingOnline ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-4">
                          <FieldHintLabel label="Online Session View" hint={USER_MANAGEMENT_FIELD_HELP.onlineOverview.tooltip} />
                          <p className="text-xs text-cyan-100/90 mt-1">{USER_MANAGEMENT_FIELD_HELP.onlineOverview.inline}</p>
                        </div>
                        <div className="flex gap-4 mb-4">
                          <div className="bg-green-900/30 border border-green-600/50 rounded-lg p-4 flex-1">
                            <div className="text-3xl font-bold text-green-400">{onlineData?.onlineCount || 0}</div>
                            <div className="text-sm text-gray-400">Online Now</div>
                          </div>
                          <div className="bg-neutral-700/50 rounded-lg p-4 flex-1">
                            <div className="text-3xl font-bold text-gray-400">{onlineData?.offlineCount || 0}</div>
                            <div className="text-sm text-gray-400">Offline</div>
                          </div>
                        </div>
                        <Table className="border-collapse">
                          <TableHeader>
                            <TableRow className="border-b border-gray-700">
                              <TableHead className="py-3 px-4 text-left text-gray-400">User</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">IP Address</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">Login Time</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400" title={USER_MANAGEMENT_FIELD_HELP.onlineOverview.tooltip}>Session Duration</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(!onlineData?.onlineUsers || onlineData.onlineUsers.length === 0) ? (
                              <TableRow>
                                <TableCell colSpan={4} className="text-center py-4 text-gray-400">
                                  No users currently online
                                </TableCell>
                              </TableRow>
                            ) : (
                              onlineData.onlineUsers.map((user) => {
                                const formatDuration = (seconds: number) => {
                                  const hours = Math.floor(seconds / 3600);
                                  const mins = Math.floor((seconds % 3600) / 60);
                                  const secs = seconds % 60;
                                  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
                                  if (mins > 0) return `${mins}m ${secs}s`;
                                  return `${secs}s`;
                                };

                                return (
                                  <TableRow key={user.id} className="border-b border-gray-700">
                                    <TableCell className="py-3 px-4">
                                      <div>
                                        <div className="font-medium flex items-center gap-2">
                                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                          {user.email}
                                        </div>
                                        <div className="text-xs text-gray-400">
                                          {user.name || user.username || `User #${user.userId}`}
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="font-mono text-sm">{user.ip || 'Unknown'}</span>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="text-sm text-gray-400">
                                        {(() => {
                                          if (!user.loginTime) return 'N/A';
                                          const d = new Date(user.loginTime);
                                          return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleString();
                                        })()}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="text-sm text-green-400 font-medium">
                                        {formatDuration(user.sessionDuration)}
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </div>
                ) : userFilterTab === "logins" ? (
                  /* Login History View */
                  <div className="overflow-x-auto">
                    {isLoadingLoginHistory ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-4">
                          <FieldHintLabel label="Login Trail" hint={USER_MANAGEMENT_FIELD_HELP.loginTrailOverview.tooltip} />
                          <p className="text-xs text-cyan-100/90 mt-1">{USER_MANAGEMENT_FIELD_HELP.loginTrailOverview.inline}</p>
                        </div>
                        <Table className="border-collapse">
                          <TableHeader>
                            <TableRow className="border-b border-gray-700">
                              <TableHead className="py-3 px-4 text-left text-gray-400">User</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">IP Address</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">User Agent</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400" title={USER_MANAGEMENT_FIELD_HELP.loginTrailOverview.tooltip}>Status</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">Time</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {allLoginHistory.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} className="text-center py-4">
                                  No login history found
                                </TableCell>
                              </TableRow>
                            ) : (
                              allLoginHistory.map((entry) => {
                                const ipValue = entry.ipAddress ?? entry.ip ?? entry.ip_address;
                                const userAgentValue = entry.userAgent ?? entry.user_agent;
                                return (
                                  <TableRow key={entry.id} className={`border-b border-gray-700 ${!entry.success ? 'bg-red-900/20' : ''}`}>
                                    <TableCell className="py-3 px-4">
                                      <div>
                                        <div className="font-medium">{entry.email}</div>
                                        <div className="text-xs text-gray-400">{entry.username || `User #${entry.userId}`}</div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="font-mono text-sm">{ipValue || 'Unknown'}</span>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="text-xs text-gray-400 max-w-xs truncate block" title={userAgentValue || ''}>
                                        {userAgentValue ? (userAgentValue.length > 50 ? userAgentValue.substring(0, 50) + '...' : userAgentValue) : 'Unknown'}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      {entry.success ? (
                                        <span className="text-xs px-2 py-0.5 rounded bg-green-600 text-white">Success</span>
                                      ) : (
                                        <div>
                                          <span className="text-xs px-2 py-0.5 rounded bg-red-600 text-white">Failed</span>
                                          {entry.failureReason && (
                                            <div className="text-xs text-red-400 mt-1">{entry.failureReason}</div>
                                          )}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="text-sm text-gray-400">
                                        {(() => {
                                          if (!entry.createdAt) return 'N/A';
                                          const ts = entry.createdAt;
                                          // Handle string ISO dates
                                          if (typeof ts === 'string') {
                                            const d = new Date(ts);
                                            if (!isNaN(d.getTime())) return d.toLocaleString();
                                            // Try as numeric string
                                            const num = Number(ts);
                                            if (!isNaN(num)) {
                                              const d2 = new Date(num > 1e12 ? num : num * 1000);
                                              return isNaN(d2.getTime()) ? 'Invalid Date' : d2.toLocaleString();
                                            }
                                            return ts;
                                          }
                                          // Handle numeric timestamps
                                          if (typeof ts === 'number') {
                                            const d = new Date(ts > 1e12 ? ts : ts * 1000);
                                            return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleString();
                                          }
                                          return String(ts);
                                        })()}
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </div>
                ) : userFilterTab === "audit" ? (
                  /* Audit Trail View */
                  <div className="overflow-x-auto">
                    {isLoadingAuditTrail ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                          <FieldHintLabel label="Audit Trail" hint={USER_MANAGEMENT_FIELD_HELP.auditOverview.tooltip} />
                          <p className="text-xs text-cyan-100/90 mt-1">{USER_MANAGEMENT_FIELD_HELP.auditOverview.inline}</p>
                        </div>
                        <div className="flex gap-4 mb-4">
                          <div className="bg-blue-900/30 border border-blue-600/50 rounded-lg p-4 flex-1">
                            <div className="text-3xl font-bold text-blue-400">{auditTrailData?.signups?.length || 0}</div>
                            <div className="text-sm text-gray-400">Recent Signups</div>
                          </div>
                          <div className="bg-green-900/30 border border-green-600/50 rounded-lg p-4 flex-1">
                            <div className="text-3xl font-bold text-green-400">{auditTrailData?.logins?.filter(l => l.success).length || 0}</div>
                            <div className="text-sm text-gray-400">Successful Logins</div>
                          </div>
                          <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-4 flex-1">
                            <div className="text-3xl font-bold text-red-400">{auditTrailData?.logins?.filter(l => !l.success).length || 0}</div>
                            <div className="text-sm text-gray-400">Failed Logins</div>
                          </div>
                          <div className="bg-orange-900/30 border border-orange-600/50 rounded-lg p-4 flex-1">
                            <div className="text-3xl font-bold text-orange-400">{auditTrailData?.adminActions?.length || 0}</div>
                            <div className="text-sm text-gray-400">Admin Actions</div>
                          </div>
                        </div>

                        {/* Event Type Filter */}
                        <div className="space-y-2">
                          <FieldHintLabel label="Event Type Filter" hint={USER_MANAGEMENT_FIELD_HELP.auditEventFilter.tooltip} />
                          <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.auditEventFilter.inline}</p>
                          <div className="flex gap-2 flex-wrap">
                            {[
                              { value: "all", label: "All Events", color: "bg-gray-600" },
                              { value: "signup", label: "Signups", color: "bg-blue-600" },
                              { value: "login_success", label: "Login Success", color: "bg-green-600" },
                              { value: "login_fail", label: "Login Fail", color: "bg-red-600" },
                              { value: "admin", label: "Admin Actions", color: "bg-orange-600" },
                            ].map(filter => (
                              <button
                                key={filter.value}
                                onClick={() => setAuditEventFilter(filter.value as any)}
                                className={`px-3 py-1.5 rounded text-sm transition ${auditEventFilter === filter.value
                                  ? `${filter.color} text-white`
                                  : "bg-neutral-700 text-gray-300 hover:bg-neutral-600"
                                  }`}
                                title={USER_MANAGEMENT_FIELD_HELP.auditEventFilter.tooltip}
                              >
                                {filter.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <Card className="bg-neutral-700 border-gray-600">
                          <CardHeader>
                            <CardTitle className="text-base">Combined Audit Timeline</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="overflow-x-auto">
                              <Table className="border-collapse min-w-[1000px]">
                                <TableHeader>
                                  <TableRow className="border-b border-gray-700">
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Time</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Event</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">User</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Details</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">IP</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Location</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Timezone</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Device</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(() => {
                                    let allEvents = [
                                      ...(auditTrailData?.signups?.map((s: any) => ({
                                        type: 'SIGNUP' as const,
                                        time: s.createdAt,
                                        email: s.email,
                                        detail: `New user: ${s.username}`,
                                        id: `signup-${s.id}`,
                                        ip: s.signupIp || null,
                                        location: [s.signupCity, s.signupRegion, s.signupCountryCode].filter(Boolean).join(', ') || null,
                                        coords: s.signupLatitude && s.signupLongitude ? `${Number(s.signupLatitude).toFixed(2)}, ${Number(s.signupLongitude).toFixed(2)}` : null,
                                        timezone: s.signupClientTz || s.signupInferredTz || null,
                                        device: [s.signupDeviceType, s.signupBrowser, s.signupOs].filter(Boolean).join(' / ') || parseUserAgent(s.signupUserAgent),
                                        userAgent: s.signupUserAgent || null,
                                      })) || []),
                                      ...(auditTrailData?.logins?.map((l: any) => {
                                        const loginIp = l.ip ?? l.ipAddress ?? l.ip_address ?? null;
                                        const loginUa = l.userAgent ?? l.user_agent ?? null;
                                        return {
                                          type: l.success ? 'LOGIN_SUCCESS' as const : 'LOGIN_FAIL' as const,
                                          time: l.createdAt,
                                          email: l.email,
                                          detail: l.success ? 'Successful login' : 'Failed login attempt',
                                          id: `login-${l.id}`,
                                          ip: loginIp,
                                          location: [l.city, l.region, l.countryCode].filter(Boolean).join(', ') || null,
                                          coords: l.latitude && l.longitude ? `${Number(l.latitude).toFixed(2)}, ${Number(l.longitude).toFixed(2)}` : null,
                                          timezone: l.clientTz || null,
                                          device: parseUserAgent(loginUa),
                                          userAgent: loginUa,
                                        };
                                      }) || []),
                                      ...(auditTrailData?.adminActions?.map((a: any) => ({
                                        type: 'ADMIN_ACTION' as const,
                                        time: a.createdAt,
                                        email: `Admin #${a.adminId} → User #${a.userId}`,
                                        detail: a.actionType,
                                        id: `admin-${a.id}`,
                                        ip: a.ip || null,
                                        location: null,
                                        coords: null,
                                        timezone: null,
                                        device: parseUserAgent(a.userAgent),
                                        userAgent: a.userAgent || null,
                                      })) || [])
                                    ];

                                    // Apply event type filter
                                    if (auditEventFilter !== "all") {
                                      allEvents = allEvents.filter(event => {
                                        if (auditEventFilter === "signup") return event.type === "SIGNUP";
                                        if (auditEventFilter === "login_success") return event.type === "LOGIN_SUCCESS";
                                        if (auditEventFilter === "login_fail") return event.type === "LOGIN_FAIL";
                                        if (auditEventFilter === "admin") return event.type === "ADMIN_ACTION";
                                        return true;
                                      });
                                    }

                                    allEvents = allEvents.sort((a, b) => b.time - a.time).slice(0, 100);

                                    if (allEvents.length === 0) {
                                      return (
                                        <TableRow>
                                          <TableCell colSpan={8} className="text-center py-4 text-gray-400">
                                            No audit events found
                                          </TableCell>
                                        </TableRow>
                                      );
                                    }

                                    return allEvents.map((event) => (
                                      <TableRow key={event.id} className="border-b border-gray-700">
                                        <TableCell className="py-3 px-3">
                                          <span className="text-sm text-gray-400 whitespace-nowrap">
                                            {new Date(event.time * 1000).toLocaleString()}
                                          </span>
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${event.type === 'SIGNUP' ? 'bg-blue-600 text-white' :
                                            event.type === 'LOGIN_SUCCESS' ? 'bg-green-600 text-white' :
                                              event.type === 'LOGIN_FAIL' ? 'bg-red-600 text-white' :
                                                'bg-orange-600 text-white'
                                            }`}>
                                            {event.type.replace('_', ' ')}
                                          </span>
                                        </TableCell>
                                        <TableCell className="py-3 px-3 font-medium text-sm">{event.email}</TableCell>
                                        <TableCell className="py-3 px-3 text-gray-400 text-sm">{event.detail}</TableCell>
                                        <TableCell className="py-3 px-3">
                                          {event.ip ? (
                                            <span className="text-xs font-mono text-cyan-400" title={event.ip}>
                                              {event.ip.length > 15 ? event.ip.slice(0, 15) + '...' : event.ip}
                                            </span>
                                          ) : (
                                            <span className="text-xs text-gray-500">-</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          {event.location ? (
                                            <div className="text-xs">
                                              <div className="text-gray-300">{event.location}</div>
                                              {event.coords && <div className="text-gray-500 text-[10px]">{event.coords}</div>}
                                            </div>
                                          ) : (
                                            <span className="text-xs text-gray-500">-</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          {event.timezone ? (
                                            <span className="text-xs text-purple-400">{event.timezone}</span>
                                          ) : (
                                            <span className="text-xs text-gray-500">-</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          {event.device ? (
                                            <span className="text-xs text-yellow-400" title={event.userAgent || ''}>
                                              {event.device.length > 30 ? event.device.slice(0, 30) + '...' : event.device}
                                            </span>
                                          ) : (
                                            <span className="text-xs text-gray-500">-</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ));
                                  })()}
                                </TableBody>
                              </Table>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </div>
                ) : userFilterTab === "kyc" ? (
                  /* KYC Queue View */
                  <div className="overflow-x-auto">
                    {isLoadingKycQueue ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-teal-900/20 border border-teal-600/50 rounded-lg p-4">
                          <FieldHintLabel
                            label="Contender Pipeline"
                            hint={USER_MANAGEMENT_FIELD_HELP.kycOverview.tooltip}
                            labelClassName="text-lg font-semibold text-teal-400"
                          />
                          <p className="text-xs text-gray-300 mt-1">{USER_MANAGEMENT_FIELD_HELP.kycOverview.inline}</p>
                          <p className="text-sm text-gray-400 mt-2">
                            Users who meet performance criteria (P1: {policySummary?.policyContenderPath1MinAgeDays ?? 30}+ days, {Math.round((policySummary?.policyContenderPath1MinBalancePct ?? 1.2) * 100)}%+ balance, {policySummary?.policyContenderPath1MinTradesLifetime ?? 30}+ trades)
                            or (P2: {policySummary?.policyContenderPath2MinAgeDays ?? 90}+ days, {Math.round((policySummary?.policyContenderPath2MinReturnLast90 ?? 0.1) * 100)}%+ last-{path2WindowDays}d return, {policySummary?.policyContenderPath2MinTradesLast90 ?? 20}+ trades, last trade within {policySummary?.policyContenderPath2MaxDaysSinceLastTrade ?? 14} days)
                            will appear here for KYC/funding consideration.
                          </p>
                        </div>

                        <Card className="bg-neutral-700 border-gray-600">
                          <CardHeader>
                            <FieldHintLabel
                              label="Policy Controls"
                              hint={USER_MANAGEMENT_FIELD_HELP.kycOverview.tooltip}
                              labelClassName="text-base font-semibold"
                            />
                            <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.kycOverview.inline}</p>
                          </CardHeader>
                          <CardContent>
                            {isLoadingPolicyConfig || !policyConfig ? (
                              <div className="text-sm text-gray-400">Loading policy controls...</div>
                            ) : (
                              <div className="space-y-4">
                                <div className="grid gap-4 md:grid-cols-2">
                                  <div className="rounded-md border border-green-600/50 p-3">
                                    <div className="text-sm font-medium text-green-500 mb-3">Path 1 Criteria</div>
                                    <div className="space-y-4">
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Age (days)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath1MinAgeDays.tooltip}
                                          labelClassName="text-sm text-green-500"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath1MinAgeDays.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath1MinAgeDays}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath1MinAgeDays.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath1MinAgeDays: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Trades (lifetime)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath1MinTradesLifetime.tooltip}
                                          labelClassName="text-sm text-green-500"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath1MinTradesLifetime.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath1MinTradesLifetime}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath1MinTradesLifetime.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath1MinTradesLifetime: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Balance Multiplier (1.20 = 120%)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath1MinBalancePct.tooltip}
                                          labelClassName="text-sm text-green-500"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath1MinBalancePct.inline}</p>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={policyConfig.policyContenderPath1MinBalancePct}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath1MinBalancePct.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath1MinBalancePct: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div className="rounded-md border border-teal-600/50 p-3">
                                    <div className="text-sm font-medium text-teal-400 mb-3">Path 2 Criteria</div>
                                    <div className="space-y-4">
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Age (days)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath2MinAgeDays.tooltip}
                                          labelClassName="text-sm text-teal-400"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath2MinAgeDays.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath2MinAgeDays}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath2MinAgeDays.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath2MinAgeDays: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label={`Min Trades (last ${path2WindowDays}d)`}
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath2MinTradesLast90.tooltip}
                                          labelClassName="text-sm text-teal-400"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath2MinTradesLast90.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath2MinTradesLast90}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath2MinTradesLast90.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath2MinTradesLast90: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Return (0.10 = 10%)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath2MinReturnLast90.tooltip}
                                          labelClassName="text-sm text-teal-400"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath2MinReturnLast90.inline}</p>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={policyConfig.policyContenderPath2MinReturnLast90}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath2MinReturnLast90.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath2MinReturnLast90: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Max Days Since Last Trade"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath2MaxDaysSinceLastTrade.tooltip}
                                          labelClassName="text-sm text-teal-400"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath2MaxDaysSinceLastTrade.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath2MaxDaysSinceLastTrade}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath2MaxDaysSinceLastTrade.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath2MaxDaysSinceLastTrade: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="rounded-md border border-gray-600/70 p-3">
                                  <div className="text-sm font-medium text-gray-200">Messaging and OTP Limits</div>
                                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                      <FieldHintLabel label="Email Resend Cooldown (sec)" hint={USER_MANAGEMENT_FIELD_HELP.kycEmailResendCooldownSec.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycEmailResendCooldownSec.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyEmailResendCooldownSec}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycEmailResendCooldownSec.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policyEmailResendCooldownSec: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="Email Daily Send Cap" hint={USER_MANAGEMENT_FIELD_HELP.kycEmailDailySendCap.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycEmailDailySendCap.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyEmailDailySendCap}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycEmailDailySendCap.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policyEmailDailySendCap: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="SMS Resend Cooldown (sec)" hint={USER_MANAGEMENT_FIELD_HELP.kycSmsResendCooldownSec.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycSmsResendCooldownSec.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policySmsResendCooldownSec}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycSmsResendCooldownSec.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policySmsResendCooldownSec: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="SMS Daily Send Cap" hint={USER_MANAGEMENT_FIELD_HELP.kycSmsDailySendCap.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycSmsDailySendCap.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policySmsDailySendCap}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycSmsDailySendCap.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policySmsDailySendCap: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="OTP Max Attempts" hint={USER_MANAGEMENT_FIELD_HELP.kycOtpMaxAttempts.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycOtpMaxAttempts.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyOtpMaxAttempts}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycOtpMaxAttempts.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policyOtpMaxAttempts: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="OTP Lock Minutes" hint={USER_MANAGEMENT_FIELD_HELP.kycOtpLockMinutes.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycOtpLockMinutes.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyOtpLockMinutes}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycOtpLockMinutes.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policyOtpLockMinutes: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <div>
                                    <FieldHintLabel label="Auto-promote Performer" hint={USER_MANAGEMENT_FIELD_HELP.kycAutoPromotePerformer.tooltip} />
                                    <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.kycAutoPromotePerformer.inline}</p>
                                  </div>
                                  <Switch
                                    checked={Boolean(policyConfig.policyAutoPromotePerformer)}
                                    title={USER_MANAGEMENT_FIELD_HELP.kycAutoPromotePerformer.tooltip}
                                    onCheckedChange={(checked) => {
                                      setPolicyConfig({
                                        ...policyConfig,
                                        policyAutoPromotePerformer: checked,
                                      });
                                      setPolicyConfigChanged(true);
                                    }}
                                  />
                                </div>
                                <div className="flex justify-end">
                                  <Button
                                    disabled={!policyConfigChanged || policyConfigMutation.isPending}
                                    onClick={() => policyConfig && policyConfigMutation.mutate(policyConfig)}
                                    title={USER_MANAGEMENT_FIELD_HELP.kycSaveControls.tooltip}
                                  >
                                    {policyConfigMutation.isPending ? "Saving..." : "Save Controls"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <Card className="bg-neutral-700 border-gray-600">
                          <CardHeader>
                            <FieldHintLabel
                              label="KYC Candidates Queue"
                              hint={USER_MANAGEMENT_FIELD_HELP.kycOverview.tooltip}
                              labelClassName="text-base font-semibold"
                            />
                            <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.kycOverview.inline}</p>
                          </CardHeader>
                          <CardContent>
                            <Table className="border-collapse">
                              <TableHeader>
                                <TableRow className="border-b border-gray-700">
                                  <TableHead className="py-3 px-4 text-left text-gray-400">User</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Account Age</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Trades (L/{path2WindowDays}d)</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Balance %</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Return {path2WindowDays}d</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Path</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Tier</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400" title={USER_MANAGEMENT_FIELD_HELP.kycInviteAction.tooltip}>Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(!kycCandidates || kycCandidates.length === 0) ? (
                                  <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-gray-400">
                                      <div className="space-y-2">
                                        <div className="text-lg">No KYC candidates yet</div>
                                        <div className="text-sm">Users will appear here when they meet the contender eligibility criteria</div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ) : (
                                  kycCandidates.map((candidate) => (
                                    <TableRow key={candidate.userId} className="border-b border-gray-700">
                                      <TableCell className="py-3 px-4">
                                        <div>
                                          <div className="font-medium">{candidate.email}</div>
                                          <div className="text-xs text-gray-400">@{candidate.username}</div>
                                        </div>
                                      </TableCell>
                                      <TableCell className="py-3 px-4">{candidate.accountAgeDays} days</TableCell>
                                      <TableCell className="py-3 px-4">{candidate.tradesLifetime} / {candidate.tradesLast90d}</TableCell>
                                      <TableCell className="py-3 px-4">
                                        <span className={candidate.balancePctOfStart >= 1 ? "text-green-400" : "text-red-400"}>
                                          {candidate.balancePctOfStart >= 1 ? "+" : ""}
                                          {((candidate.balancePctOfStart - 1) * 100).toFixed(2)}%
                                        </span>
                                      </TableCell>
                                      <TableCell className="py-3 px-4">
                                        {(candidate.returnLast90d * 100).toFixed(2)}%
                                      </TableCell>
                                      <TableCell className="py-3 px-4">
                                        <span className="text-xs px-2 py-0.5 rounded bg-blue-700 text-white">
                                          {candidate.contenderPath1 ? "P1" : candidate.contenderPath2 ? "P2" : "N/A"}
                                        </span>
                                      </TableCell>
                                      <TableCell className="py-3 px-4">
                                        <span className="text-xs px-2 py-0.5 rounded bg-gray-600 text-white">
                                          {candidate.userTier} / {candidate.contenderTier}
                                        </span>
                                      </TableCell>
                                      <TableCell className="py-3 px-4">
                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-xs bg-green-700 hover:bg-green-600 border-0"
                                            onClick={() => inviteKycMutation.mutate({ userId: candidate.userId })}
                                            disabled={inviteKycMutation.isPending}
                                            title={USER_MANAGEMENT_FIELD_HELP.kycInviteAction.tooltip}
                                          >
                                            Invite KYC
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-xs bg-red-700 hover:bg-red-600 border-0"
                                            onClick={() => updateKycStatusMutation.mutate({ userId: candidate.userId, status: 'REJECTED' })}
                                            disabled={updateKycStatusMutation.isPending}
                                            title={USER_MANAGEMENT_FIELD_HELP.kycRejectAction.tooltip}
                                          >
                                            Reject
                                          </Button>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </CardContent>
                        </Card>

                        <KycQueueTab />
                      </div>
                    )}
                  </div>
                ) : userFilterTab === "activity" ? (
                  /* Activity View */
                  <div className="overflow-x-auto">
                    <UserActivityAdmin />
                  </div>
                ) : userFilterTab === "grift" ? (
                  /* Grift Detection View */
                  <div className="overflow-x-auto">
                    {(isLoadingGriftSummary || isLoadingGriftUsers || isLoadingGriftAlerts) ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500"></div>
                      </div>
                    ) : (
                      <GriftAdmin />
                    )}
                  </div>
                ) : isLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-3">
                      <FieldHintLabel label="User List Controls" hint={USER_MANAGEMENT_FIELD_HELP.columnsPicker.tooltip} />
                      <p className="text-xs text-cyan-100/90 mt-1">{USER_MANAGEMENT_FIELD_HELP.columnsPicker.inline}</p>
                    </div>
                    {/* Column visibility dropdown */}
                    <div className="flex justify-end mb-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="bg-neutral-700 text-xs" title={USER_MANAGEMENT_FIELD_HELP.columnsPicker.tooltip}>
                            Columns ▾
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-neutral-800 border-gray-600">
                          {([
                            { key: 'name', label: 'Names' },
                            { key: 'phone', label: 'Phone' },
                            { key: 'username', label: 'Username' },
                            { key: 'email', label: 'Email' },
                            { key: 'status', label: 'Status' },
                            { key: 'balance', label: 'Balance' },
                            { key: 'leverage', label: 'Leverage' },
                            { key: 'maxTrades', label: 'Max Trades' },
                            { key: 'minHold', label: 'Min Hold' },
                            { key: 'maxHold', label: 'Max Hold' },
                            { key: 'leaderboard', label: 'Leaderboard' },
                          ] as { key: UserColumnKey; label: string }[]).map(col => (
                            <DropdownMenuCheckboxItem
                              key={col.key}
                              checked={visibleColumns[col.key]}
                              onCheckedChange={(checked) => setVisibleColumns(prev => ({ ...prev, [col.key]: !!checked }))}
                              className="text-xs cursor-pointer focus:bg-neutral-700"
                              title={USER_MANAGEMENT_FIELD_HELP.columnsPicker.tooltip}
                            >
                              {col.label}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="overflow-x-auto">
                      <Table className="border-collapse">
                        <TableHeader>
                          <TableRow className="border-b border-gray-700">
                            <TableHead className="py-3 px-2 w-10">
                              <Checkbox
                                checked={selectedUserIds.length > 0 && selectedUserIds.length === filteredUsers.length}
                                onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                title={USER_MANAGEMENT_FIELD_HELP.selectAllVisible.tooltip}
                              />
                            </TableHead>
                            {visibleColumns.name && (
                              <TableHead className="py-2 px-4 text-left text-gray-400">
                                <div className="space-y-1">
                                  <FieldHintLabel
                                    label="Names"
                                    hint={USER_MANAGEMENT_FIELD_HELP.nameFilter.tooltip}
                                    labelClassName="text-xs font-medium text-gray-300"
                                  />
                                  <Input
                                    placeholder="Search..."
                                    value={columnFilters.name}
                                    onChange={(e) => setColumnFilters(prev => ({ ...prev, name: e.target.value }))}
                                    className="h-7 text-xs bg-neutral-700 w-full"
                                    title={USER_MANAGEMENT_FIELD_HELP.nameFilter.tooltip}
                                  />
                                </div>
                              </TableHead>
                            )}
                            {visibleColumns.phone && (
                              <TableHead className="py-2 px-4 text-left text-gray-400">
                                <div className="space-y-1">
                                  <FieldHintLabel
                                    label="Phone"
                                    hint={USER_MANAGEMENT_FIELD_HELP.phoneFilter.tooltip}
                                    labelClassName="text-xs font-medium text-gray-300"
                                  />
                                  <Input
                                    placeholder="Search..."
                                    value={columnFilters.phone}
                                    onChange={(e) => setColumnFilters(prev => ({ ...prev, phone: e.target.value }))}
                                    className="h-7 text-xs bg-neutral-700 w-full"
                                    title={USER_MANAGEMENT_FIELD_HELP.phoneFilter.tooltip}
                                  />
                                </div>
                              </TableHead>
                            )}
                            {visibleColumns.username && (
                              <TableHead className="py-2 px-4 text-left text-gray-400">
                                <div className="space-y-1">
                                  <FieldHintLabel
                                    label="Username"
                                    hint={USER_MANAGEMENT_FIELD_HELP.usernameFilter.tooltip}
                                    labelClassName="text-xs font-medium text-gray-300"
                                  />
                                  <Input
                                    placeholder="Search..."
                                    value={columnFilters.username}
                                    onChange={(e) => setColumnFilters(prev => ({ ...prev, username: e.target.value }))}
                                    className="h-7 text-xs bg-neutral-700 w-full"
                                    title={USER_MANAGEMENT_FIELD_HELP.usernameFilter.tooltip}
                                  />
                                </div>
                              </TableHead>
                            )}
                            {visibleColumns.email && (
                              <TableHead className="py-2 px-4 text-left text-gray-400">
                                <div className="space-y-1">
                                  <FieldHintLabel
                                    label="Email"
                                    hint={USER_MANAGEMENT_FIELD_HELP.emailFilter.tooltip}
                                    labelClassName="text-xs font-medium text-gray-300"
                                  />
                                  <Input
                                    placeholder="Search..."
                                    value={columnFilters.email}
                                    onChange={(e) => setColumnFilters(prev => ({ ...prev, email: e.target.value }))}
                                    className="h-7 text-xs bg-neutral-700 w-full"
                                    title={USER_MANAGEMENT_FIELD_HELP.emailFilter.tooltip}
                                  />
                                </div>
                              </TableHead>
                            )}
                            {visibleColumns.status && <TableHead className="py-3 px-4 text-left text-gray-400">Status</TableHead>}
                            {visibleColumns.balance && <TableHead className="py-3 px-4 text-left text-gray-400">Balance</TableHead>}
                            {visibleColumns.leverage && <TableHead className="py-3 px-4 text-left text-gray-400">Leverage</TableHead>}
                            {visibleColumns.maxTrades && <TableHead className="py-3 px-4 text-left text-gray-400">Max Trades</TableHead>}
                            {visibleColumns.minHold && <TableHead className="py-3 px-4 text-left text-gray-400">Min Hold (s)</TableHead>}
                            {visibleColumns.maxHold && <TableHead className="py-3 px-4 text-left text-gray-400">Max Hold (s)</TableHead>}
                            {visibleColumns.leaderboard && <TableHead className="py-3 px-4 text-left text-gray-400" title={USER_MANAGEMENT_FIELD_HELP.leaderboardVisibility.tooltip}>Leaderboard</TableHead>}
                            <TableHead className="py-3 px-4 text-left text-gray-400">
                              <div className="flex items-center gap-2">
                                <span>Actions</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                      aria-label="User row actions hint"
                                    >
                                      Hint
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                                    {USER_MANAGEMENT_FIELD_HELP.rowActions.tooltip}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredUsers.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={10} className="text-center py-4">
                                No users found
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredUsers.map((user) => (
                              <TableRow
                                key={user.id}
                                className={`border-b border-gray-700 ${user.isFrozen ? 'bg-blue-900/20' : user.isDisabled ? 'bg-red-900/20' : ''}`}
                              >
                                <TableCell className="py-3 px-2">
                                  <Checkbox
                                    checked={selectedUserIds.includes(user.id)}
                                    onCheckedChange={(checked) => handleSelectUser(user.id, !!checked)}
                                    title={USER_MANAGEMENT_FIELD_HELP.selectAllVisible.tooltip}
                                  />
                                </TableCell>
                                {visibleColumns.name && (
                                  <TableCell className="py-3 px-4">
                                    <span className="text-sm">{user.name || '-'}</span>
                                  </TableCell>
                                )}
                                {visibleColumns.phone && (
                                  <TableCell className="py-3 px-4">
                                    <span className="text-sm">{user.phone || '-'}</span>
                                  </TableCell>
                                )}
                                {visibleColumns.username && (
                                  <TableCell className="py-3 px-4">
                                    <span className="text-sm font-medium">{user.username}</span>
                                  </TableCell>
                                )}
                                {visibleColumns.email && (
                                  <TableCell className="py-3 px-4">
                                    <span className="text-sm">{user.email}</span>
                                  </TableCell>
                                )}
                                {visibleColumns.status && (
                                  <TableCell className="py-3 px-4">
                                    <div className="flex flex-col gap-1">
                                      {user.isAdmin && (
                                        <span className="text-xs px-2 py-0.5 rounded bg-purple-600 text-white">Admin</span>
                                      )}
                                      {user.isFrozen ? (
                                        <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white">Frozen</span>
                                      ) : user.isDisabled ? (
                                        <span className="text-xs px-2 py-0.5 rounded bg-red-600 text-white">Disabled</span>
                                      ) : (
                                        <span className="text-xs px-2 py-0.5 rounded bg-green-600 text-white">Active</span>
                                      )}
                                    </div>
                                  </TableCell>
                                )}
                                {visibleColumns.balance && (
                                  <TableCell className="py-3 px-4">
                                    <Input
                                      type="text"
                                      defaultValue={user.balance}
                                      title={USER_MANAGEMENT_FIELD_HELP.balanceEditor.tooltip}
                                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                        if (e.key === 'Enter') {
                                          updateBalance(user.id, e.currentTarget.value);
                                        }
                                      }}
                                      onBlur={(e) => updateBalance(user.id, e.currentTarget.value)}
                                      className="w-28 h-8 bg-neutral-700"
                                    />
                                  </TableCell>
                                )}
                                {visibleColumns.leverage && (
                                  <TableCell className="py-3 px-4">{user.leverage || 'Default'}</TableCell>
                                )}
                                {visibleColumns.maxTrades && (
                                  <TableCell className="py-3 px-4">{user.maxConcurrent || 'Default'}</TableCell>
                                )}
                                {visibleColumns.minHold && (
                                  <TableCell className="py-3 px-4">{user.minHoldSec || 'Default'}</TableCell>
                                )}
                                {visibleColumns.maxHold && (
                                  <TableCell className="py-3 px-4">{user.maxHoldSec || 'Default'}</TableCell>
                                )}
                                {visibleColumns.leaderboard && (
                                  <TableCell className="py-3 px-4">
                                    <Switch
                                      checked={user.showOnLeaderboard !== false}
                                      title={USER_MANAGEMENT_FIELD_HELP.leaderboardVisibility.tooltip}
                                      onCheckedChange={(checked) => {
                                        const settings = {
                                          userId: user.id,
                                          leverage: user.leverage || 50,
                                          maxConcurrent: user.maxConcurrent || 5,
                                          maxConcurrentLots: user.maxConcurrentLots || 50,
                                          minHoldSec: user.minHoldSec || 60,
                                          maxHoldSec: user.maxHoldSec || 86400,
                                          showOnLeaderboard: checked
                                        };
                                        mutation.mutate(settings);
                                      }}
                                    />
                                  </TableCell>
                                )}
                                <TableCell className="py-3 px-4">
                                  <div className="flex flex-wrap gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleEdit(user)}
                                      className="bg-neutral-700 hover:bg-neutral-600 h-7 text-xs px-2"
                                      title={USER_MANAGEMENT_FIELD_HELP.editAction.tooltip}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openTimeline(user)}
                                      className="bg-neutral-700 hover:bg-neutral-600 h-7 text-xs px-2"
                                      title={USER_MANAGEMENT_FIELD_HELP.timelineAction.tooltip}
                                    >
                                      Timeline
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openNotes(user)}
                                      className="bg-neutral-700 hover:bg-neutral-600 h-7 text-xs px-2"
                                      title={USER_MANAGEMENT_FIELD_HELP.notesAction.tooltip}
                                    >
                                      Notes
                                    </Button>
                                    {user.isDisabled ? (
                                      /* Disabled users (including frozen+disabled) only get Enable button */
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toggleUserStatusMutation.mutate({ userId: user.id, disabled: false })}
                                        disabled={toggleUserStatusMutation.isPending}
                                        className="bg-green-600 hover:bg-green-700 border-0 h-7 text-xs px-2"
                                        title={USER_MANAGEMENT_FIELD_HELP.enableAction.tooltip}
                                      >
                                        {toggleUserStatusMutation.isPending ? '...' : 'Enable'}
                                      </Button>
                                    ) : user.isFrozen ? (
                                      /* Frozen only users get Unfreeze + Disable */
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => unfreezeUserMutation.mutate(user.id)}
                                          disabled={unfreezeUserMutation.isPending}
                                          className="bg-blue-600 hover:bg-blue-700 border-0 h-7 text-xs px-2"
                                          title={USER_MANAGEMENT_FIELD_HELP.unfreezeAction.tooltip}
                                        >
                                          {unfreezeUserMutation.isPending ? '...' : 'Unfreeze'}
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => toggleUserStatusMutation.mutate({ userId: user.id, disabled: true })}
                                          disabled={toggleUserStatusMutation.isPending}
                                          className="bg-red-600 hover:bg-red-700 border-0 h-7 text-xs px-2"
                                          title={USER_MANAGEMENT_FIELD_HELP.disableAction.tooltip}
                                        >
                                          {toggleUserStatusMutation.isPending ? '...' : 'Disable'}
                                        </Button>
                                      </>
                                    ) : (
                                      /* Active users get Freeze + Disable */
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => openFreeze(user)}
                                          className="bg-amber-600 hover:bg-amber-700 border-0 h-7 text-xs px-2"
                                          title={USER_MANAGEMENT_FIELD_HELP.freezeAction.tooltip}
                                        >
                                          Freeze
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => toggleUserStatusMutation.mutate({ userId: user.id, disabled: true })}
                                          disabled={toggleUserStatusMutation.isPending}
                                          className="bg-red-600 hover:bg-red-700 border-0 h-7 text-xs px-2"
                                          title={USER_MANAGEMENT_FIELD_HELP.disableAction.tooltip}
                                        >
                                          {toggleUserStatusMutation.isPending ? '...' : 'Disable'}
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                      <p className="text-xs text-gray-400 mt-3">{USER_MANAGEMENT_FIELD_HELP.rowActions.inline}</p>
                    </div>
                  </>
                )}
              </TooltipProvider>
            </TabsContent>

            <TabsContent value="view-as" className="p-4">
              <TooltipProvider delayDuration={120}>
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <FieldHintLabel
                      label="View as Trader"
                      hint={VIEW_AS_TRADER_FIELD_HELP.overview.tooltip}
                      labelClassName="text-xl font-semibold"
                    />
                    <p className="text-xs text-gray-400 mt-1">{VIEW_AS_TRADER_FIELD_HELP.overview.inline}</p>
                  </div>
                </div>
                <p className="text-gray-400 mb-4">
                  Select a trader to view the platform from their perspective. This is useful for debugging and support purposes.
                  All impersonation actions are logged for audit compliance.
                </p>

                <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-4">
                  Impersonation controls include hidden <span className="font-medium">Hint</span> explainers for safe account selection and audit-aware action usage.
                </div>

                <div className="mb-4 max-w-md">
                  <FieldHintLabel label="Trader Search Filter" hint={VIEW_AS_TRADER_FIELD_HELP.searchFilter.tooltip} />
                  <Input
                    placeholder="Search by name, email, username, or phone..."
                    value={columnFilters.email}
                    onChange={(e) => setColumnFilters(prev => ({ ...prev, email: e.target.value }))}
                    className="bg-neutral-700 border-gray-600 mt-1"
                    title={VIEW_AS_TRADER_FIELD_HELP.searchFilter.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{VIEW_AS_TRADER_FIELD_HELP.searchFilter.inline}</p>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-gray-700">
                        <TableHead className="text-gray-300">ID</TableHead>
                        <TableHead className="text-gray-300">Name</TableHead>
                        <TableHead className="text-gray-300">Username</TableHead>
                        <TableHead className="text-gray-300">Email</TableHead>
                        <TableHead className="text-gray-300">Phone</TableHead>
                        <TableHead className="text-gray-300">Balance</TableHead>
                        <TableHead className="text-gray-300">Status</TableHead>
                        <TableHead className="text-gray-300">
                          <div className="flex items-center gap-2">
                            <span>Action</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                  aria-label="View as action hint"
                                >
                                  Hint
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                                {VIEW_AS_TRADER_FIELD_HELP.viewAsAction.tooltip}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
                      ) : (
                        users
                          .filter(user => !user.isAdmin)
                          .filter(user => !columnFilters.email ||
                            user.email.toLowerCase().includes(columnFilters.email.toLowerCase()) ||
                            user.username?.toLowerCase().includes(columnFilters.email.toLowerCase()) ||
                            user.phone?.toLowerCase().includes(columnFilters.email.toLowerCase()) ||
                            user.name?.toLowerCase().includes(columnFilters.email.toLowerCase())
                          )
                          .map(user => (
                            <TableRow key={user.id} className="border-gray-700 hover:bg-neutral-700">
                              <TableCell className="py-3 text-gray-400">{user.id}</TableCell>
                              <TableCell className="py-3">{user.name || '-'}</TableCell>
                              <TableCell className="py-3">{user.username || '-'}</TableCell>
                              <TableCell className="py-3">{user.email}</TableCell>
                              <TableCell className="py-3 text-gray-400">{user.phone || '-'}</TableCell>
                              <TableCell className="py-3">${Number(user.balance || 0).toFixed(2)}</TableCell>
                              <TableCell className="py-3">
                                {user.isDisabled ? (
                                  <span className="text-red-400">Disabled</span>
                                ) : user.isFrozen ? (
                                  <span className="text-amber-400">Frozen</span>
                                ) : (
                                  <span className="text-green-400">Active</span>
                                )}
                              </TableCell>
                              <TableCell className="py-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => viewAsMutation.mutate(user.id)}
                                  disabled={viewAsMutation.isPending}
                                  className="bg-purple-600 hover:bg-purple-700 border-0"
                                  title={VIEW_AS_TRADER_FIELD_HELP.viewAsAction.tooltip}
                                >
                                  {viewAsMutation.isPending ? 'Starting...' : 'View As'}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-gray-400 mt-3">{VIEW_AS_TRADER_FIELD_HELP.viewAsAction.inline}</p>
              </TooltipProvider>
            </TabsContent>

            <TabsContent value="trades" className="p-4">
              <h2 className="text-xl font-semibold mb-4">Trade Settings</h2>
              <p className="text-gray-400">Configure global trade parameters, risk management, and trading hours.</p>
              <p className="text-xs text-gray-400 mt-2">
                All times are UTC, percentages are whole numbers (10 = 10%), and monetary values are in USD.
              </p>

              {/* This would be populated with trade settings controls */}
              <TooltipProvider delayDuration={120}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="col-span-1 md:col-span-2 rounded-md border border-cyan-900/60 bg-cyan-950/20 p-3">
                    <p className="text-sm text-cyan-100">
                      Each field includes a hidden <span className="font-medium">Hint</span> explainer with deeper behavior details, guardrail impact, and operational cautions.
                    </p>
                  </div>
                  <Card className="bg-neutral-700 border-gray-600 col-span-1 md:col-span-2">
                    <CardHeader className="border-b border-gray-600 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm sm:text-base text-cyan-300">Default Capital Settings</CardTitle>
                        <p className="text-xs text-gray-400">
                          Global defaults used for new user account capital and challenge virtual capital.
                        </p>
                      </div>
                      {riskParamsChanged && (
                        <Button
                          size="sm"
                          onClick={handleSaveRiskParams}
                          disabled={globalSettingsMutation.isPending}
                          className="shrink-0 w-full sm:w-auto text-xs sm:text-sm"
                        >
                          {globalSettingsMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <FieldHintLabel
                            label="Default User Starting Balance (USD)"
                            hint={TRADE_SETTINGS_FIELD_HELP.defaultUserStartingBalanceUsd}
                          />
                          <Input
                            type="number"
                            min={1}
                            value={riskParams.defaultUserStartingBalanceUsd}
                            onChange={(e) =>
                              handleRiskParamChange("defaultUserStartingBalanceUsd", Math.max(1, Number(e.target.value) || 1))
                            }
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Starting cash balance assigned when a new user account is created</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Default User Starting Equity (USD)"
                            hint={TRADE_SETTINGS_FIELD_HELP.defaultUserStartingEquityUsd}
                          />
                          <Input
                            type="number"
                            min={1}
                            value={riskParams.defaultUserStartingEquityUsd}
                            onChange={(e) =>
                              handleRiskParamChange("defaultUserStartingEquityUsd", Math.max(1, Number(e.target.value) || 1))
                            }
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Opening equity baseline used for new user account risk calculations</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Default Challenge Virtual Capital (USD)"
                            hint={TRADE_SETTINGS_FIELD_HELP.defaultChallengeVirtualCapitalUsd}
                          />
                          <Input
                            type="number"
                            min={1}
                            value={riskParams.defaultChallengeVirtualCapitalUsd}
                            onChange={(e) =>
                              handleRiskParamChange("defaultChallengeVirtualCapitalUsd", Math.max(1, Number(e.target.value) || 1))
                            }
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Prefilled virtual capital for new challenge drafts unless overridden</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600">
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm sm:text-base">Market Hours (UTC)</CardTitle>
                        <p className="text-xs text-gray-400">Configure trading hours in UTC timezone</p>
                      </div>
                      {riskParamsChanged && (
                        <Button
                          size="sm"
                          onClick={handleSaveRiskParams}
                          disabled={globalSettingsMutation.isPending}
                          className="shrink-0 w-full sm:w-auto text-xs sm:text-sm"
                        >
                          {globalSettingsMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <FieldHintLabel
                              label="Opening Time (UTC)"
                              hint={TRADE_SETTINGS_FIELD_HELP.marketOpenTime}
                            />
                            <Input
                              type="time"
                              value={riskParams.marketOpenTime}
                              onChange={(e) => handleRiskParamChange('marketOpenTime', e.target.value)}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">First UTC time when opening new trades is allowed</p>
                          </div>
                          <div>
                            <FieldHintLabel
                              label="Closing Time (UTC)"
                              hint={TRADE_SETTINGS_FIELD_HELP.marketCloseTime}
                            />
                            <Input
                              type="time"
                              value={riskParams.marketCloseTime}
                              onChange={(e) => handleRiskParamChange('marketCloseTime', e.target.value)}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Last UTC time when opening new trades is allowed</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="weekend"
                              checked={riskParams.allowWeekendTrading}
                              onCheckedChange={(checked) => handleRiskParamChange('allowWeekendTrading', Boolean(checked))}
                            />
                            <Label htmlFor="weekend">Allow weekend trading</Label>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                aria-label="Allow weekend trading hint"
                              >
                                Hint
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                              {TRADE_SETTINGS_FIELD_HELP.allowWeekendTrading}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">When disabled, opening new trades is restricted to weekdays</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600">
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <CardTitle className="text-sm sm:text-base min-w-0">Default Risk Parameters</CardTitle>
                      {riskParamsChanged && (
                        <Button
                          size="sm"
                          onClick={handleSaveRiskParams}
                          disabled={globalSettingsMutation.isPending}
                          className="shrink-0 w-full sm:w-auto text-xs sm:text-sm"
                        >
                          {globalSettingsMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div>
                          <FieldHintLabel
                            label="Default Leverage"
                            hint={TRADE_SETTINGS_FIELD_HELP.defaultLeverage}
                          />
                          <Input
                            type="number"
                            value={riskParams.defaultLeverage}
                            onChange={(e) => handleRiskParamChange('defaultLeverage', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Default leverage applied to new accounts unless an override is set</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Max Position Size"
                            hint={TRADE_SETTINGS_FIELD_HELP.maxPositionSize}
                          />
                          <Input
                            type="number"
                            value={riskParams.maxPositionSize}
                            onChange={(e) => handleRiskParamChange('maxPositionSize', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Largest size allowed for a single open position</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Maximum Trades Per User"
                            hint={TRADE_SETTINGS_FIELD_HELP.maxTradesPerUser}
                          />
                          <Input
                            type="number"
                            value={riskParams.maxTradesPerUser}
                            onChange={(e) => handleRiskParamChange('maxTradesPerUser', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Maximum number of concurrent trades allowed per user</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Maximum Trades Per Instrument"
                            hint={TRADE_SETTINGS_FIELD_HELP.maxTradesPerInstrument}
                          />
                          <Input
                            type="number"
                            value={riskParams.maxTradesPerInstrument}
                            onChange={(e) => handleRiskParamChange('maxTradesPerInstrument', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Maximum number of concurrent trades allowed per instrument</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Maximum Concurrent Lots Per User"
                            hint={TRADE_SETTINGS_FIELD_HELP.maxConcurrentLots}
                          />
                          <Input
                            type="number"
                            value={riskParams.maxConcurrentLots}
                            onChange={(e) => handleRiskParamChange('maxConcurrentLots', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Maximum total lots allowed across all open trades per user</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Minimum Price Distance (pips)"
                            hint={TRADE_SETTINGS_FIELD_HELP.minPriceDistancePips}
                          />
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            value={riskParams.minPriceDistancePips}
                            onChange={(e) => handleRiskParamChange('minPriceDistancePips', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Minimum distance enforced for pending orders and TP/SL (open + edits)</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600 col-span-1 md:col-span-2">
                    <CardHeader className="border-b border-gray-600">
                      <CardTitle className="text-sm sm:text-base text-green-400">Trade Auto-Close Settings and Minimum Hold Times</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="enableAutoClose"
                              checked={riskParams.enableAutoClose}
                              onCheckedChange={(checked) => handleRiskParamChange('enableAutoClose', checked)}
                            />
                            <Label htmlFor="enableAutoClose" className="text-sm">Enable auto-close for trades</Label>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                aria-label="Enable auto-close for trades hint"
                              >
                                Hint
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                              {TRADE_SETTINGS_FIELD_HELP.enableAutoClose}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">When enabled, eligible open trades are closed after the configured hold period</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <FieldHintLabel
                              label="Auto-close after (days)"
                              hint={TRADE_SETTINGS_FIELD_HELP.autoCloseAfterDays}
                            />
                            <Input
                              type="number"
                              value={riskParams.autoCloseAfterDays}
                              onChange={(e) => handleRiskParamChange('autoCloseAfterDays', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Trades will auto-close after this many days</p>
                          </div>
                          <div>
                            <FieldHintLabel
                              label="Check frequency (minutes)"
                              hint={TRADE_SETTINGS_FIELD_HELP.autoCloseCheckFrequencyMinutes}
                            />
                            <Input
                              type="number"
                              value={riskParams.autoCloseCheckFrequencyMinutes}
                              onChange={(e) => handleRiskParamChange('autoCloseCheckFrequencyMinutes', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">How often the system checks for trades to close</p>
                          </div>
                          <div>
                            <FieldHintLabel
                              label="Minimum Hold Time (seconds)"
                              hint={TRADE_SETTINGS_FIELD_HELP.minHoldSec}
                            />
                            <Input
                              type="number"
                              value={riskParams.minHoldSec}
                              onChange={(e) => handleRiskParamChange('minHoldSec', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Global default - users can have overrides</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600 col-span-1 md:col-span-2">
                    <CardHeader className="border-b border-gray-600">
                      <CardTitle className="text-sm sm:text-base text-orange-400">Loss Limit Controls</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2 mb-4">
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="enableLossLimits"
                              checked={riskParams.enableLossLimits}
                              onCheckedChange={(checked) => handleRiskParamChange('enableLossLimits', checked)}
                            />
                            <Label htmlFor="enableLossLimits" className="text-sm">Enable loss limit protection</Label>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                aria-label="Enable loss limit protection hint"
                              >
                                Hint
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                              {TRADE_SETTINGS_FIELD_HELP.enableLossLimits}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">When enabled, trading is constrained if daily or lifetime loss thresholds are exceeded</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <FieldHintLabel
                              label="Daily Loss Limit (%)"
                              hint={TRADE_SETTINGS_FIELD_HELP.dailyLossLimitPct}
                            />
                            <Input
                              type="number"
                              value={riskParams.dailyLossLimitPct}
                              onChange={(e) => handleRiskParamChange('dailyLossLimitPct', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Maximum daily loss as percentage of initial balance</p>
                          </div>
                          <div>
                            <FieldHintLabel
                              label="Lifetime Loss Limit (%)"
                              hint={TRADE_SETTINGS_FIELD_HELP.lifetimeLossLimitPct}
                            />
                            <Input
                              type="number"
                              value={riskParams.lifetimeLossLimitPct}
                              onChange={(e) => handleRiskParamChange('lifetimeLossLimitPct', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Maximum lifetime loss before account is disabled</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600 col-span-1 md:col-span-2">
                    <CardHeader className="border-b border-gray-600 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm sm:text-base text-purple-400">Visual Lot Settings</CardTitle>
                        <p className="text-xs text-gray-400">Configure lot preset quick-select cards and dropdown maximum for the trader order form</p>
                      </div>
                      {riskParamsChanged && (
                        <Button
                          size="sm"
                          onClick={handleSaveRiskParams}
                          disabled={globalSettingsMutation.isPending}
                          className="shrink-0 w-full sm:w-auto text-xs sm:text-sm"
                        >
                          {globalSettingsMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="space-y-6">
                        {/* Preset Cards Editor */}
                        <div>
                          <FieldHintLabel
                            label="Lot Preset Cards"
                            hint={TRADE_SETTINGS_FIELD_HELP.lotPresetCards}
                          />
                          <p className="text-xs text-gray-400 mb-3">Quick-select buttons shown to traders on the order form</p>
                          <p className="text-xs text-gray-400 mb-3">Each value is a lot-size shortcut and should stay within the dropdown maximum</p>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {(() => {
                              try {
                                const presets: number[] = JSON.parse(riskParams.lotPresetCards || "[]");
                                return presets.map((value, index) => (
                                  <div key={index} className="flex items-center gap-1 bg-neutral-600 rounded-md px-2 py-1">
                                    <Input
                                      type="number"
                                      value={value}
                                      onChange={(e) => {
                                        const newValue = parseInt(e.target.value) || 1;
                                        const maxAllowed = Math.min(50, riskParams.lotDropdownMax || 50);
                                        const updated = [...presets];
                                        updated[index] = Math.max(1, Math.min(maxAllowed, newValue));
                                        handleRiskParamChange('lotPresetCards', JSON.stringify(updated));
                                      }}
                                      className="w-16 h-7 text-xs bg-neutral-700 border-gray-500 text-center"
                                      min={1}
                                      max={Math.min(50, riskParams.lotDropdownMax || 50)}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = presets.filter((_, i) => i !== index);
                                        handleRiskParamChange('lotPresetCards', JSON.stringify(updated));
                                      }}
                                      className="text-gray-400 hover:text-red-400 px-1"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ));
                              } catch {
                                return <span className="text-red-400 text-xs">Invalid preset data</span>;
                              }
                            })()}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                try {
                                  const presets: number[] = JSON.parse(riskParams.lotPresetCards || "[]");
                                  const maxAllowed = Math.min(50, riskParams.lotDropdownMax || 50);
                                  const newValue = presets.length > 0 ? Math.min((presets[presets.length - 1] || 1) * 2, maxAllowed) : 1;
                                  handleRiskParamChange('lotPresetCards', JSON.stringify([...presets, newValue]));
                                } catch {
                                  handleRiskParamChange('lotPresetCards', JSON.stringify([1]));
                                }
                              }}
                              className="h-7 text-xs bg-neutral-600 hover:bg-neutral-500"
                            >
                              + Add
                            </Button>
                          </div>
                        </div>

                        {/* Dropdown Max */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <FieldHintLabel
                              label="Dropdown Maximum Lots"
                              hint={TRADE_SETTINGS_FIELD_HELP.lotDropdownMax}
                            />
                            <Input
                              type="number"
                              value={riskParams.lotDropdownMax}
                              onChange={(e) => handleRiskParamChange('lotDropdownMax', Math.max(1, Math.min(50, Number(e.target.value) || 50)))}
                              className="bg-neutral-600"
                              min={1}
                              max={50}
                            />
                            <p className="text-xs text-gray-400 mt-1">Maximum lot value shown in the dropdown selector (1-50)</p>
                          </div>
                          <div className="flex items-end">
                            <div className="w-full p-3 bg-neutral-800 rounded-md border border-gray-600">
                              <p className="text-xs text-gray-400 mb-2">Preview (dropdown options):</p>
                              <div className="flex flex-wrap gap-1 text-xs">
                                {(() => {
                                  const max = riskParams.lotDropdownMax || 50;
                                  const options = Array.from({ length: Math.min(max, 50) }, (_v, i) => i + 1);
                                  return options.slice(0, 12).map(n => (
                                    <span key={n} className="px-1.5 py-0.5 bg-neutral-700 rounded">{n}</span>
                                  ));
                                })()}
                                {riskParams.lotDropdownMax > 12 && <span className="text-gray-500">...</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                </div>
              </TooltipProvider>
            </TabsContent>

            <TabsContent value="instruments" className="p-4">
              <TooltipProvider delayDuration={120}>
                <Tabs value={instrumentsSubTab} onValueChange={(v) => setInstrumentsSubTab(v as any)} className="space-y-4">
                  <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-3 gap-1">
                    <TabsTrigger value="configured" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Configured</TabsTrigger>
                    <TabsTrigger value="ingestor" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Ingestor</TabsTrigger>
                    <TabsTrigger value="quoteSubscriptions" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Quote Subscriptions</TabsTrigger>
                  </TabsList>

                  <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                    Instruments controls include hidden <span className="font-medium">Hint</span> explainers for symbol identity, risk-impacting fields, and rollout safety.
                  </div>

                  <TabsContent value="configured">
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <FieldHintLabel
                          label="Trading Instruments"
                          hint={INSTRUMENTS_FIELD_HELP.configuredOverview.tooltip}
                          labelClassName="text-xl font-semibold"
                        />
                        <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.configuredOverview.inline}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="bg-neutral-700 hover:bg-neutral-600"
                          onClick={() => setCatalogEnableDialogOpen(true)}
                          title={INSTRUMENTS_FIELD_HELP.addFromCatalog.tooltip}
                        >
                          Add From Catalog
                        </Button>
                        <Button
                          variant="default"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => setNewSymbolDialogOpen(true)}
                          title={INSTRUMENTS_FIELD_HELP.addNewInstrument.tooltip}
                        >
                          Add New Instrument
                        </Button>
                      </div>
                    </div>

                    <p className="text-gray-400 mb-4">Configure the trading instruments available on the platform, including spread settings and lot limits.</p>

                    {isLoadingSymbols ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        {/* Active Instruments */}
                        <div className="mb-6">
                          <h3 className="text-lg font-semibold mb-2">Active Instruments</h3>
                          <Table className="border-collapse">
                            <TableHeader>
                              <TableRow className="border-b border-gray-700">
                                <TableHead className="py-3 px-4 text-left text-gray-400">Symbol</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Name</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Base/Quote</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Min Spread (pips)</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Min/Max Lot</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Status</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {symbols.filter(symbol => symbol.enabled).length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={7} className="text-center py-4">
                                    No active instruments configured
                                  </TableCell>
                                </TableRow>
                              ) : (
                                symbols.filter(symbol => symbol.enabled).map((symbol) => (
                                  <TableRow key={symbol.id} className="border-b border-gray-700">
                                    <TableCell className="py-3 px-4 font-semibold">{symbol.symbol}</TableCell>
                                    <TableCell className="py-3 px-4">{symbol.name}</TableCell>
                                    <TableCell className="py-3 px-4">{symbol.baseCurrency || '-'}/{symbol.quoteCurrency || '-'}</TableCell>
                                    <TableCell className="py-3 px-4">{symbol.minSpreadPips}</TableCell>
                                    <TableCell className="py-3 px-4">{symbol.minLot} / {symbol.maxLot} lots</TableCell>
                                    <TableCell className="py-3 px-4">
                                      <div className="flex items-center">
                                        <div className="w-3 h-3 rounded-full mr-2 bg-green-500"></div>
                                        <span>Active</span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <div className="flex space-x-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleEditSymbol(symbol)}
                                          className="bg-neutral-700 hover:bg-neutral-600"
                                          title={INSTRUMENTS_FIELD_HELP.editAction.tooltip}
                                        >
                                          Edit
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => confirmDeleteSymbol(symbol.id)}
                                          className="bg-red-800 hover:bg-red-700 border-red-700"
                                          title={INSTRUMENTS_FIELD_HELP.removeAction.tooltip}
                                        >
                                          Remove
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>

                        {/* Inactive Instruments */}
                        <div>
                          <h3 className="text-lg font-semibold mb-2 text-gray-300">Inactive Instruments</h3>
                          <Table className="border-collapse">
                            <TableHeader>
                              <TableRow className="border-b border-gray-700">
                                <TableHead className="py-3 px-4 text-left text-gray-400">Symbol</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Name</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Base/Quote</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Min Spread (pips)</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Min/Max Lot</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Status</TableHead>
                                <TableHead className="py-3 px-4 text-left text-gray-400">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {symbols.filter(symbol => !symbol.enabled).length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={7} className="text-center py-4 text-gray-400">
                                    No inactive instruments
                                  </TableCell>
                                </TableRow>
                              ) : (
                                symbols.filter(symbol => !symbol.enabled).map((symbol) => (
                                  <TableRow key={symbol.id} className="border-b border-gray-700 opacity-75">
                                    <TableCell className="py-3 px-4 font-semibold">{symbol.symbol}</TableCell>
                                    <TableCell className="py-3 px-4">{symbol.name}</TableCell>
                                    <TableCell className="py-3 px-4">{symbol.baseCurrency || '-'}/{symbol.quoteCurrency || '-'}</TableCell>
                                    <TableCell className="py-3 px-4">{symbol.minSpreadPips}</TableCell>
                                    <TableCell className="py-3 px-4">{symbol.minLot} / {symbol.maxLot} lots</TableCell>
                                    <TableCell className="py-3 px-4">
                                      <div className="flex items-center">
                                        <div className="w-3 h-3 rounded-full mr-2 bg-red-500"></div>
                                        <span>Inactive</span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <div className="flex space-x-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleEditSymbol(symbol)}
                                          className="bg-neutral-700 hover:bg-neutral-600"
                                          title={INSTRUMENTS_FIELD_HELP.editAction.tooltip}
                                        >
                                          Edit
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => confirmDeleteSymbol(symbol.id)}
                                          className="bg-red-800 hover:bg-red-700 border-red-700"
                                          title={INSTRUMENTS_FIELD_HELP.removeAction.tooltip}
                                        >
                                          Remove
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="ingestor">
                    <div className="space-y-4">
                      <InstrumentIngestionPanel />
                      <PipDefaultsPanel />
                    </div>
                  </TabsContent>

                  <TabsContent value="quoteSubscriptions">
                    <QuoteSubscriptionsPanel />
                  </TabsContent>
                </Tabs>
              </TooltipProvider>
            </TabsContent>

            <TabsContent value="data" className="p-0">
              <AdminData />
            </TabsContent>

            <TabsContent value="audit" className="p-4">
              <AdminTradeAudit />
            </TabsContent>

            <TabsContent value="communications" className="p-4">
              <AdminCommunications />
            </TabsContent>

            {scoutTabVisible && (
              <TabsContent value="scout" className="p-4">
                <ScoutWorkbench />
              </TabsContent>
            )}

            <TabsContent value="system" className="p-4">
              <SystemConfigTab />
            </TabsContent>

            <TabsContent value="legal" className="p-4">
              <AdminLegalPanel />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit User Settings: {editingUser?.email}</DialogTitle>
            <p className="text-xs text-blue-400 mt-1">User overrides take precedence and can exceed global limits</p>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="leverage">Leverage</Label>
                <Input
                  id="leverage"
                  type="number"
                  value={editForm.leverage}
                  onChange={(e) => handleChange("leverage", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Maximum leverage this user can use for trading</p>
              </div>

              <div>
                <Label htmlFor="maxConcurrent">Max Concurrent Trades</Label>
                <Input
                  id="maxConcurrent"
                  type="number"
                  value={editForm.maxConcurrent}
                  onChange={(e) => handleChange("maxConcurrent", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Maximum number of open positions allowed</p>
              </div>

              <div>
                <Label htmlFor="maxConcurrentPerInstrument">Max Per Instrument (optional)</Label>
                <Input
                  id="maxConcurrentPerInstrument"
                  type="number"
                  value={editForm.maxConcurrentPerInstrument ?? ""}
                  onChange={(e) => handleChange("maxConcurrentPerInstrument", e.target.value === "" ? null : Number(e.target.value))}
                  className="bg-neutral-700"
                  placeholder="Use global default"
                />
                <p className="text-xs text-gray-400 mt-1">Leave blank to use global default</p>
              </div>

              <div>
                <Label htmlFor="maxConcurrentLots">Max Concurrent Lots</Label>
                <Input
                  id="maxConcurrentLots"
                  type="number"
                  value={editForm.maxConcurrentLots}
                  onChange={(e) => handleChange("maxConcurrentLots", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Maximum total lots this user can have open at once</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="minHoldSec">Minimum Hold Time (seconds)</Label>
                <Input
                  id="minHoldSec"
                  type="number"
                  value={editForm.minHoldSec}
                  onChange={(e) => handleChange("minHoldSec", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Minimum time a position must be held before closing</p>
              </div>

              <div>
                <Label htmlFor="maxHoldSec">Maximum Hold Time (seconds)</Label>
                <Input
                  id="maxHoldSec"
                  type="number"
                  value={editForm.maxHoldSec}
                  onChange={(e) => handleChange("maxHoldSec", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Maximum time a position can be held before auto-closing</p>
              </div>
            </div>

            <div className="col-span-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="showOnLeaderboard"
                  checked={editForm.showOnLeaderboard}
                  onCheckedChange={(checked) => handleChange("showOnLeaderboard", Boolean(checked))}
                />
                <Label htmlFor="showOnLeaderboard">Show on Leaderboard</Label>
              </div>
              <p className="text-xs text-gray-400 mt-1">Whether this user's performance should be visible on the leaderboard</p>
            </div>
          </div>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                if (globalSettingsData) {
                  setEditForm(prev => ({
                    ...prev,
                    leverage: globalSettingsData.defaultLeverage,
                    maxConcurrent: globalSettingsData.maxTradesPerUser,
                    maxConcurrentPerInstrument: null,
                    maxConcurrentLots: globalSettingsData.maxConcurrentLots,
                    minHoldSec: 60,
                    maxHoldSec: globalSettingsData.autoCloseAfterDays * 24 * 3600,
                  }));
                }
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Sync to Defaults
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="bg-neutral-700">
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700">
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Symbol Dialog */}
      <Dialog open={symbolDialogOpen} onOpenChange={setSymbolDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl">
          <TooltipProvider delayDuration={120}>
            <DialogHeader>
              <DialogTitle>Edit Trading Instrument: {editingSymbol?.symbol}</DialogTitle>
            </DialogHeader>
            <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mt-3">
              Symbol edits include hidden <span className="font-medium">Hint</span> explainers for pricing precision, lot guardrails, and live-trading impact.
            </div>

            <div className="grid grid-cols-2 gap-6 py-4">
              <div className="space-y-4">
                <div>
                  <FieldHintLabel label="Symbol" hint={INSTRUMENTS_FIELD_HELP.symbol.tooltip} />
                  <div className="pt-1" title={INSTRUMENTS_FIELD_HELP.symbol.tooltip}>
                    <SymbolSelect
                      defaultSymbol={editingSymbol?.symbol || ''}
                      onSelected={(opt) => {
                        // Auto-fill all fields from the selected symbol
                        handleSymbolChange("symbol", opt.value);
                        handleSymbolChange("name", opt.displayName);
                        handleSymbolChange("baseCurrency", opt.base);
                        handleSymbolChange("quoteCurrency", opt.quote);
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.symbol.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Display Name" hint={INSTRUMENTS_FIELD_HELP.displayName.tooltip} />
                  <Input
                    id="name"
                    value={editingSymbol?.name || ''}
                    onChange={(e) => handleSymbolChange("name", e.target.value)}
                    className="bg-neutral-700 mt-1"
                    title={INSTRUMENTS_FIELD_HELP.displayName.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.displayName.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Category" hint={INSTRUMENTS_FIELD_HELP.category.tooltip} />
                  <Select
                    value={editingSymbol?.category || ''}
                    onValueChange={(val) => handleSymbolChange("category", val)}
                  >
                    <SelectTrigger className="bg-neutral-700 mt-1" title={INSTRUMENTS_FIELD_HELP.category.tooltip}>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-gray-700">
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="stocks">Stocks</SelectItem>
                      <SelectItem value="etf">ETFs</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="commodities">Commodities</SelectItem>
                      <SelectItem value="bonds">Bonds</SelectItem>
                      <SelectItem value="funds">Funds</SelectItem>
                      <SelectItem value="mutual_funds">Mutual Funds</SelectItem>
                      <SelectItem value="indices">Indices</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.category.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Minimum Spread (pips)" hint={INSTRUMENTS_FIELD_HELP.minSpreadPips.tooltip} />
                  <Input
                    id="minSpreadPips"
                    type="number"
                    step="0.1"
                    value={editingSymbol?.minSpreadPips || 2}
                    onChange={(e) => handleSymbolChange("minSpreadPips", Number(e.target.value))}
                    className="bg-neutral-700 mt-1"
                    title={INSTRUMENTS_FIELD_HELP.minSpreadPips.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.minSpreadPips.inline}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Base Currency" hint={INSTRUMENTS_FIELD_HELP.baseCurrency.tooltip} />
                    <Input
                      id="baseCurrency"
                      value={editingSymbol?.baseCurrency || ''}
                      onChange={(e) => handleSymbolChange("baseCurrency", e.target.value)}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.baseCurrency.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.baseCurrency.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Quote Currency" hint={INSTRUMENTS_FIELD_HELP.quoteCurrency.tooltip} />
                    <Input
                      id="quoteCurrency"
                      value={editingSymbol?.quoteCurrency || ''}
                      onChange={(e) => handleSymbolChange("quoteCurrency", e.target.value)}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.quoteCurrency.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.quoteCurrency.inline}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Pip Decimals" hint={INSTRUMENTS_FIELD_HELP.pipDecimals.tooltip} />
                    <Input
                      id="pipDecimals"
                      type="number"
                      min={0}
                      max={12}
                      value={editingSymbol?.pipDecimals ?? ""}
                      onChange={(e) =>
                        handleSymbolChange("pipDecimals", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.pipDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.pipDecimals.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Quote Decimals" hint={INSTRUMENTS_FIELD_HELP.quoteDecimals.tooltip} />
                    <Input
                      id="quoteDecimals"
                      type="number"
                      min={0}
                      max={12}
                      value={editingSymbol?.quoteDecimals ?? ""}
                      onChange={(e) =>
                        handleSymbolChange("quoteDecimals", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.quoteDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.quoteDecimals.inline}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Min Lot Size" hint={INSTRUMENTS_FIELD_HELP.minLot.tooltip} />
                    <Input
                      id="minLot"
                      type="number"
                      value={editingSymbol?.minLot || 1}
                      onChange={(e) => handleSymbolChange("minLot", Number(e.target.value))}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.minLot.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.minLot.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Max Lot Size" hint={INSTRUMENTS_FIELD_HELP.maxLot.tooltip} />
                    <Input
                      id="maxLot"
                      type="number"
                      value={editingSymbol?.maxLot || 50}
                      onChange={(e) => handleSymbolChange("maxLot", Number(e.target.value))}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.maxLot.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.maxLot.inline}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-4">
                  <div>
                    <FieldHintLabel label="Enabled for Trading" hint={INSTRUMENTS_FIELD_HELP.enabled.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.enabled.inline}</p>
                  </div>
                  <Switch
                    id="enabled"
                    checked={editingSymbol?.enabled}
                    onCheckedChange={(checked) => handleSymbolChange("enabled", Boolean(checked))}
                    title={INSTRUMENTS_FIELD_HELP.enabled.tooltip}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSymbolDialogOpen(false)} className="bg-neutral-700">
                Cancel
              </Button>
              <Button
                onClick={handleSymbolSave}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={symbolUpdateMutation.isPending}
              >
                {symbolUpdateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      <InstrumentCatalogEnableDialog open={catalogEnableDialogOpen} onOpenChange={setCatalogEnableDialogOpen} />

      {/* New Symbol Dialog */}
      <Dialog open={newSymbolDialogOpen} onOpenChange={setNewSymbolDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl">
          <TooltipProvider delayDuration={120}>
            <DialogHeader>
              <DialogTitle>Add New Trading Instrument</DialogTitle>
            </DialogHeader>
            <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mt-3">
              New symbol setup includes hidden <span className="font-medium">Hint</span> explainers for naming standards, precision controls, and exposure guardrails.
            </div>

            <div className="grid grid-cols-2 gap-6 py-4">
              <div className="space-y-4">
                <div>
                  <FieldHintLabel label="Symbol" hint={INSTRUMENTS_FIELD_HELP.symbol.tooltip} />
                  <div className="pt-1" title={INSTRUMENTS_FIELD_HELP.symbol.tooltip}>
                    <SymbolSelect
                      defaultSymbol={newSymbol.symbol || ''}
                      onSelected={(opt) => {
                        // Auto-fill all fields from the selected symbol
                        handleNewSymbolChange("symbol", opt.value);
                        handleNewSymbolChange("name", opt.displayName);
                        handleNewSymbolChange("baseCurrency", opt.base);
                        handleNewSymbolChange("quoteCurrency", opt.quote);
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.symbol.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Display Name" hint={INSTRUMENTS_FIELD_HELP.displayName.tooltip} />
                  <Input
                    id="new-name"
                    value={newSymbol.name}
                    onChange={(e) => handleNewSymbolChange("name", e.target.value)}
                    className="bg-neutral-700 mt-1"
                    title={INSTRUMENTS_FIELD_HELP.displayName.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.displayName.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Category" hint={INSTRUMENTS_FIELD_HELP.category.tooltip} />
                  <Select
                    value={(newSymbol.category as string) || ''}
                    onValueChange={(val) => handleNewSymbolChange("category", val)}
                  >
                    <SelectTrigger className="bg-neutral-700 mt-1" title={INSTRUMENTS_FIELD_HELP.category.tooltip}>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-gray-700">
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="stocks">Stocks</SelectItem>
                      <SelectItem value="etf">ETFs</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="commodities">Commodities</SelectItem>
                      <SelectItem value="bonds">Bonds</SelectItem>
                      <SelectItem value="funds">Funds</SelectItem>
                      <SelectItem value="mutual_funds">Mutual Funds</SelectItem>
                      <SelectItem value="indices">Indices</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.category.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Minimum Spread (pips)" hint={INSTRUMENTS_FIELD_HELP.minSpreadPips.tooltip} />
                  <Input
                    id="new-minSpreadPips"
                    type="number"
                    step="0.1"
                    value={newSymbol.minSpreadPips}
                    onChange={(e) => handleNewSymbolChange("minSpreadPips", Number(e.target.value))}
                    className="bg-neutral-700 mt-1"
                    title={INSTRUMENTS_FIELD_HELP.minSpreadPips.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.minSpreadPips.inline}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Base Currency" hint={INSTRUMENTS_FIELD_HELP.baseCurrency.tooltip} />
                    <Input
                      id="new-baseCurrency"
                      value={newSymbol.baseCurrency}
                      onChange={(e) => handleNewSymbolChange("baseCurrency", e.target.value)}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.baseCurrency.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.baseCurrency.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Quote Currency" hint={INSTRUMENTS_FIELD_HELP.quoteCurrency.tooltip} />
                    <Input
                      id="new-quoteCurrency"
                      value={newSymbol.quoteCurrency}
                      onChange={(e) => handleNewSymbolChange("quoteCurrency", e.target.value)}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.quoteCurrency.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.quoteCurrency.inline}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Pip Decimals" hint={INSTRUMENTS_FIELD_HELP.pipDecimals.tooltip} />
                    <Input
                      id="new-pipDecimals"
                      type="number"
                      min={0}
                      max={12}
                      value={newSymbol.pipDecimals ?? ""}
                      onChange={(e) =>
                        handleNewSymbolChange("pipDecimals", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.pipDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.pipDecimals.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Quote Decimals" hint={INSTRUMENTS_FIELD_HELP.quoteDecimals.tooltip} />
                    <Input
                      id="new-quoteDecimals"
                      type="number"
                      min={0}
                      max={12}
                      value={newSymbol.quoteDecimals ?? ""}
                      onChange={(e) =>
                        handleNewSymbolChange("quoteDecimals", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.quoteDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.quoteDecimals.inline}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Min Lot Size" hint={INSTRUMENTS_FIELD_HELP.minLot.tooltip} />
                    <Input
                      id="new-minLot"
                      type="number"
                      value={newSymbol.minLot}
                      onChange={(e) => handleNewSymbolChange("minLot", Number(e.target.value))}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.minLot.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.minLot.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Max Lot Size" hint={INSTRUMENTS_FIELD_HELP.maxLot.tooltip} />
                    <Input
                      id="new-maxLot"
                      type="number"
                      value={newSymbol.maxLot}
                      onChange={(e) => handleNewSymbolChange("maxLot", Number(e.target.value))}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.maxLot.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.maxLot.inline}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-4">
                  <div>
                    <FieldHintLabel label="Enabled for Trading" hint={INSTRUMENTS_FIELD_HELP.enabled.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.enabled.inline}</p>
                  </div>
                  <Switch
                    id="new-enabled"
                    checked={newSymbol.enabled}
                    onCheckedChange={(checked) => handleNewSymbolChange("enabled", Boolean(checked))}
                    title={INSTRUMENTS_FIELD_HELP.enabled.tooltip}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setNewSymbolDialogOpen(false)} className="bg-neutral-700">
                Cancel
              </Button>
              <Button
                onClick={handleNewSymbolSave}
                className="bg-green-600 hover:bg-green-700"
                disabled={newSymbolMutation.isPending}
              >
                {newSymbolMutation.isPending ? 'Creating...' : 'Create Instrument'}
              </Button>
            </DialogFooter>
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="bg-neutral-800 text-white border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              This will remove the trading instrument from the platform.
              Any open trades using this instrument will not be affected,
              but new trades cannot be opened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-neutral-700 text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSymbol}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* User Timeline Dialog - Vertical Timeline with Dots */}
      <Dialog open={timelineDialogOpen} onOpenChange={setTimelineDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-3xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Activity Timeline: {timelineUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto py-4 pl-4">
            {userTimeline.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No activity found</p>
            ) : (
              <div className="relative">
                {/* Vertical timeline line */}
                <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-600"></div>

                {userTimeline.map((event, index) => {
                  const dotColor =
                    event.type === 'ACCOUNT_CREATED' ? 'bg-emerald-500' :
                      event.type === 'LOGIN' ? (event.description?.includes('Failed') ? 'bg-red-500' : 'bg-green-500') :
                        event.type === 'LOGOUT' ? 'bg-yellow-500' :
                          event.type === 'TRADE' || event.type === 'TRADE_OPENED' || event.type === 'TRADE_CLOSED' ? 'bg-blue-500' :
                            event.type === 'FREEZE' || event.type === 'UNFREEZE' ? 'bg-amber-500' :
                              event.type === 'STATUS_CHANGE' ? 'bg-purple-500' :
                                event.type === 'ADMIN_ACTION' ? 'bg-orange-500' :
                                  'bg-gray-400';

                  const formatSessionLength = (seconds: number | undefined) => {
                    if (!seconds) return 'Unknown';
                    const hours = Math.floor(seconds / 3600);
                    const mins = Math.floor((seconds % 3600) / 60);
                    const secs = seconds % 60;
                    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
                    if (mins > 0) return `${mins}m ${secs}s`;
                    return `${secs}s`;
                  };

                  return (
                    <div key={event.id} className="relative pl-8 pb-6 last:pb-0">
                      {/* Timeline dot */}
                      <div className={`absolute left-0 top-1 w-4 h-4 rounded-full ${dotColor} border-2 border-neutral-800 z-10`}></div>

                      {/* Content card */}
                      <div className={`p-3 rounded-lg ${event.severity === 'HIGH' || event.severity === 'CRITICAL' ? 'bg-red-900/30 border border-red-600/50' :
                        event.severity === 'WARN' ? 'bg-amber-900/30 border border-amber-600/50' :
                          'bg-neutral-700/50'
                        }`}>
                        <div className="flex flex-wrap justify-between items-start gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded ${event.type === 'ACCOUNT_CREATED' ? 'bg-emerald-600' :
                              event.type === 'LOGIN' ? 'bg-green-600' :
                                event.type === 'LOGOUT' ? 'bg-yellow-600' :
                                  event.type === 'TRADE' || event.type === 'TRADE_OPENED' ? 'bg-blue-600' :
                                    event.type === 'TRADE_CLOSED' ? 'bg-indigo-600' :
                                      event.type === 'FREEZE' ? 'bg-amber-600' :
                                        event.type === 'UNFREEZE' ? 'bg-cyan-600' :
                                          event.type === 'STATUS_CHANGE' ? 'bg-purple-600' :
                                            event.type === 'ADMIN_ACTION' ? 'bg-orange-600' :
                                              'bg-gray-600'
                              }`}>{event.type === 'ACCOUNT_CREATED' ? 'CREATED' : event.type}</span>
                            <span className="font-medium text-sm">{event.title}</span>
                          </div>
                          <span className="text-xs text-gray-400">
                            {(() => {
                              if (!event.timestamp) return 'No date';
                              const ts = event.timestamp;
                              if (typeof ts === 'string') {
                                const d = new Date(ts);
                                return isNaN(d.getTime()) ? ts : d.toLocaleString();
                              }
                              if (typeof ts === 'number') {
                                const d = new Date(ts > 1e12 ? ts : ts * 1000);
                                return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleString();
                              }
                              return String(ts);
                            })()}
                          </span>
                        </div>
                        {event.description && (
                          <p className="text-sm text-gray-400">{event.description}</p>
                        )}
                        {event.reasonCode && (
                          <p className="text-xs text-amber-400 mt-1">Reason: {event.reasonCode}</p>
                        )}

                        {/* Login/Logout specific info */}
                        {event.type === 'LOGIN' && event.loginIp && (
                          <div className="mt-2 text-xs text-gray-500">
                            <span>IP: {event.loginIp}</span>
                          </div>
                        )}
                        {event.type === 'LOGOUT' && (
                          <div className="mt-2 text-xs text-gray-500 space-y-1">
                            {event.sessionLengthSec !== undefined && (
                              <div>Session Length: <span className="text-green-400">{formatSessionLength(event.sessionLengthSec)}</span></div>
                            )}
                            {event.loginIp && <div>IP: {event.loginIp}</div>}
                          </div>
                        )}

                        {/* Other metadata */}
                        {event.metadata && event.type !== 'LOGIN' && event.type !== 'LOGOUT' && (
                          <div className="mt-2 text-xs text-gray-500">
                            {event.metadata.ipAddress && <span className="mr-3">IP: {event.metadata.ipAddress}</span>}
                            {event.metadata.profit !== undefined && <span className="mr-3">P/L: ${Number(event.metadata.profit).toFixed(2)}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="csv"
              onClick={() => window.open(`/api/admin/export/users/${timelineUser?.id}/timeline`, '_blank')}
            >
              Export CSV
            </Button>
            <Button
              variant="jsonl"
              onClick={() => window.open(`/api/admin/export/users/${timelineUser?.id}/timeline/jsonl`, '_blank')}
            >
              Export JSONL
            </Button>
            <Button variant="outline" onClick={() => setTimelineDialogOpen(false)} className="bg-neutral-700">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Freeze User Dialog */}
      <Dialog open={freezeDialogOpen} onOpenChange={setFreezeDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>Freeze Account: {freezeUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-gray-400 text-sm">
              Freezing an account will prevent the user from opening new trades.
              They will still be able to close existing positions.
            </p>
            <div>
              <Label htmlFor="freezeReasonCode">Reason Code</Label>
              <select
                id="freezeReasonCode"
                value={freezeReason.code}
                onChange={(e) => setFreezeReason(prev => ({ ...prev, code: e.target.value }))}
                className="w-full p-2 rounded bg-neutral-700 border border-gray-600 mt-1"
              >
                <option value="">Select a reason...</option>
                <option value="COMPLIANCE_REVIEW">Compliance Review</option>
                <option value="SUSPICIOUS_ACTIVITY">Suspicious Activity</option>
                <option value="KYC_REQUIRED">KYC Documentation Required</option>
                <option value="MARGIN_CALL">Margin Call - Risk Management</option>
                <option value="USER_REQUEST">User Requested</option>
                <option value="ADMIN_DISCRETION">Admin Discretion</option>
              </select>
            </div>
            <div>
              <Label htmlFor="freezeReasonText">Additional Notes (Optional)</Label>
              <textarea
                id="freezeReasonText"
                value={freezeReason.text}
                onChange={(e) => setFreezeReason(prev => ({ ...prev, text: e.target.value }))}
                className="w-full p-2 rounded bg-neutral-700 border border-gray-600 mt-1 h-20"
                placeholder="Add any additional details..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFreezeDialogOpen(false)} className="bg-neutral-700">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (freezeUser && freezeReason.code) {
                  freezeUserMutation.mutate({
                    userId: freezeUser.id,
                    reasonCode: freezeReason.code,
                    reasonText: freezeReason.text || undefined,
                  });
                }
              }}
              disabled={!freezeReason.code || freezeUserMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {freezeUserMutation.isPending ? 'Freezing...' : 'Freeze Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Notes Dialog */}
      <Dialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Admin Notes: {notesUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="border border-gray-600 rounded p-3">
              <div className="flex gap-2 mb-2">
                <select
                  value={newNote.type}
                  onChange={(e) => setNewNote(prev => ({ ...prev, type: e.target.value as 'NOTE' | 'FLAG' }))}
                  className="p-2 rounded bg-neutral-700 border border-gray-600 text-sm"
                >
                  <option value="NOTE">Note</option>
                  <option value="FLAG">Flag</option>
                </select>
                <select
                  value={newNote.severity}
                  onChange={(e) => setNewNote(prev => ({ ...prev, severity: e.target.value as any }))}
                  className="p-2 rounded bg-neutral-700 border border-gray-600 text-sm"
                >
                  <option value="INFO">Info</option>
                  <option value="WARN">Warning</option>
                  <option value="HIGH">High Priority</option>
                  <option value="CRITICAL">Critical</option>
                </select>
                {newNote.type === 'FLAG' && (
                  <Input
                    placeholder="Flag code (e.g. KYC_PENDING)"
                    value={newNote.flagCode}
                    onChange={(e) => setNewNote(prev => ({ ...prev, flagCode: e.target.value }))}
                    className="bg-neutral-700 flex-1"
                  />
                )}
              </div>
              <textarea
                value={newNote.content}
                onChange={(e) => setNewNote(prev => ({ ...prev, content: e.target.value }))}
                className="w-full p-2 rounded bg-neutral-700 border border-gray-600 h-16"
                placeholder="Add note content..."
              />
              <Button
                size="sm"
                onClick={() => {
                  if (notesUser && newNote.content.trim()) {
                    addNoteMutation.mutate({
                      userId: notesUser.id,
                      type: newNote.type,
                      severity: newNote.severity,
                      content: newNote.content,
                      flagCode: newNote.flagCode || undefined,
                    });
                  }
                }}
                disabled={!newNote.content.trim() || addNoteMutation.isPending}
                className="mt-2 bg-blue-600 hover:bg-blue-700"
              >
                {addNoteMutation.isPending ? 'Adding...' : 'Add Note'}
              </Button>
            </div>

            <div className="max-h-[40vh] overflow-y-auto space-y-2">
              {userNotes.length === 0 ? (
                <p className="text-gray-400 text-center py-4">No notes yet</p>
              ) : (
                userNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`p-3 rounded border-l-4 ${note.isResolved ? 'opacity-50 border-gray-500 bg-neutral-700' :
                      note.severity === 'CRITICAL' ? 'border-red-500 bg-red-900/20' :
                        note.severity === 'HIGH' ? 'border-orange-500 bg-orange-900/20' :
                          note.severity === 'WARN' ? 'border-amber-500 bg-amber-900/20' :
                            'border-blue-500 bg-neutral-700'
                      }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex gap-2 items-center">
                        <span className={`text-xs px-2 py-0.5 rounded ${note.type === 'FLAG' ? 'bg-red-600' : 'bg-blue-600'}`}>
                          {note.type}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-neutral-600">{note.severity}</span>
                        {note.flagCode && (
                          <span className="text-xs text-amber-400">{note.flagCode}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(Number(note.createdAt) * 1000).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm mt-2">{note.content}</p>
                    {!note.isResolved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resolveNoteMutation.mutate(note.id)}
                        className="mt-2 h-6 text-xs"
                      >
                        Mark Resolved
                      </Button>
                    )}
                    {note.isResolved && (
                      <p className="text-xs text-green-400 mt-2">
                        Resolved {note.resolvedAt ? new Date(Number(note.resolvedAt) * 1000).toLocaleDateString() : ''}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesDialogOpen(false)} className="bg-neutral-700">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
