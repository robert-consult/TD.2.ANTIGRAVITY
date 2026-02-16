import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";

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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

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
  // Visual Lot Settings
  lotPresetCards: string; // JSON array string
  lotDropdownMax: number;
  updatedAt: number | null;
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
        <Label className="text-base font-medium">FX Rollover Time Zone</Label>
        <p className="text-xs text-gray-400 mt-1">
          IANA time zone used to define the daily rollover boundary
        </p>
        <Select
          value={config.fxRolloverTz}
          onValueChange={(value) => {
            setConfig(prev => prev ? { ...prev, fxRolloverTz: value } : prev);
            setConfigChanged(true);
          }}
        >
          <SelectTrigger className="bg-neutral-600 mt-2">
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
        <Label className="text-base font-medium">FX Rollover Time</Label>
        <p className="text-xs text-gray-400 mt-1">
          Daily close cutoff used for previous close calculations (HH:MM in 24h format)
        </p>
        <Input
          type="time"
          value={config.fxRolloverTime}
          onChange={(e) => {
            setConfig(prev => prev ? { ...prev, fxRolloverTime: e.target.value } : prev);
            setConfigChanged(true);
          }}
          className="bg-neutral-600 mt-2"
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
    <div className="space-y-6">
      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Migration Export/Import Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-base font-medium">Chunk exports/imports</Label>
              <p className="text-xs text-gray-400 mt-1">
                When enabled, exports are split into fixed-size parts for resilient downloads.
              </p>
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
              <Label className="text-base font-medium">Chunk size (GB)</Label>
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
              <Label className="text-base font-medium">Scope</Label>
              <Select value={exportScope} onValueChange={setExportScope}>
                <SelectTrigger className="bg-neutral-600 mt-2">
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
                <Label className="text-base font-medium">Trader User ID</Label>
                <Input
                  type="number"
                  value={exportUserId}
                  onChange={(e) => setExportUserId(e.target.value)}
                  className="bg-neutral-600 mt-2"
                  placeholder="e.g. 123"
                />
              </div>
            )}

            {exportScope === "DELTA" && (
              <div>
                <Label className="text-base font-medium">Since (local time)</Label>
                <Input
                  type="datetime-local"
                  value={exportSince}
                  onChange={(e) => setExportSince(e.target.value)}
                  className="bg-neutral-600 mt-2"
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
              <Label className="text-base font-medium">Mode</Label>
              <Select value={importMode} onValueChange={setImportMode}>
                <SelectTrigger className="bg-neutral-600 mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRY_RUN">Dry run (validate only)</SelectItem>
                  <SelectItem value="IMPORT">Import (write data)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-base font-medium">Manifest (manifest.json)</Label>
              <Input
                type="file"
                accept=".json,application/json"
                className="bg-neutral-600 mt-2"
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
              <Label className="text-base font-medium">
                {importManifestMeta?.chunked ? "Data parts (*.ndjson) - select all" : "Data (data.ndjson)"}
              </Label>
              <Input
                type="file"
                multiple={Boolean(importManifestMeta?.chunked)}
                accept=".ndjson,application/x-ndjson"
                className="bg-neutral-600 mt-2"
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
            <Label className="text-base font-medium">Purge exports older than (days)</Label>
            <Input
              type="number"
              min={1}
              value={purgeDays}
              onChange={(e) => setPurgeDays(e.target.value)}
              className="bg-neutral-600 mt-1 w-40"
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
            <Label className="text-base font-medium">Purge imports older than (days)</Label>
            <Input
              type="number"
              min={1}
              value={importPurgeDays}
              onChange={(e) => setImportPurgeDays(e.target.value)}
              className="bg-neutral-600 mt-1 w-40"
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
  );
}

function SystemConfigTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [subTab, setSubTab] = useState("trading");
  const [config, setConfig] = useState<SystemConfigData | null>(null);
  const [configChanged, setConfigChanged] = useState(false);
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
        <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-1">
          <TabsTrigger value="trading" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Trading Controls</TabsTrigger>
          <TabsTrigger value="market" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Market Data</TabsTrigger>
          <TabsTrigger value="compliance" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Signup Compliance</TabsTrigger>
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
              <div className="flex justify-between items-center py-3 border-b border-gray-600">
                <div>
                  <Label className="text-base font-medium">Maintenance Mode</Label>
                  <p className="text-xs text-gray-400 mt-1">Blocks trading UI for non-admins and shows maintenance banner</p>
                </div>
                <Switch
                  checked={config.maintenanceMode}
                  onCheckedChange={(v) => handleToggleChange("maintenanceMode", v, "Maintenance Mode")}
                />
              </div>

              <div className="flex justify-between items-center py-3 border-b border-gray-600">
                <div>
                  <Label className="text-base font-medium text-red-400">Trading Halt (Kill Switch)</Label>
                  <p className="text-xs text-gray-400 mt-1">Hard stops ALL new trade opens platform-wide</p>
                </div>
                <Switch
                  checked={config.tradingHalt}
                  onCheckedChange={(v) => handleToggleChange("tradingHalt", v, "Trading Halt")}
                />
              </div>

              <div className="flex justify-between items-center py-3 border-b border-gray-600">
                <div>
                  <Label className="text-base font-medium text-amber-400">Close-Only Mode</Label>
                  <p className="text-xs text-gray-400 mt-1">No new positions allowed, only closing existing ones</p>
                </div>
                <Switch
                  checked={config.closeOnlyMode}
                  onCheckedChange={(v) => handleToggleChange("closeOnlyMode", v, "Close-Only Mode")}
                />
              </div>

              <div className="flex justify-between items-center py-3 border-b border-gray-600">
                <div>
                  <Label className="text-base font-medium">Block Open on Stale Quotes</Label>
                  <p className="text-xs text-gray-400 mt-1">Prevents opening trades when quote data is stale</p>
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
                <Label className="text-base font-medium">Maintenance Message</Label>
                <p className="text-xs text-gray-400 mt-1">Message shown to users when maintenance mode is active</p>
                <Input
                  value={config.maintenanceMessage}
                  onChange={(e) => {
                    setConfig(prev => prev ? { ...prev, maintenanceMessage: e.target.value } : prev);
                    setConfigChanged(true);
                  }}
                  className="bg-neutral-600 mt-2"
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* MARKET DATA & REFRESH */}
        <TabsContent value="market">
          <div className="space-y-4">
            <Card className="bg-neutral-700 border-gray-600">
              <CardHeader>
                <CardTitle className="text-base">Market Data & Quote Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <Label className="text-base font-medium">Client Quote Refresh (ms)</Label>
                    <p className="text-xs text-gray-400 mt-1">How often client polls for quote updates</p>
                    <Input
                      type="number"
                      value={config.quoteRefreshMs}
                      onChange={(e) => {
                        setConfig(prev => prev ? { ...prev, quoteRefreshMs: Number(e.target.value) } : prev);
                        setConfigChanged(true);
                      }}
                      className="bg-neutral-600 mt-2"
                      min={100}
                    />
                  </div>

                  <div>
                    <Label className="text-base font-medium">Server Feed Poll (ms)</Label>
                    <p className="text-xs text-gray-400 mt-1">How often server fetches market data (ingestor role)</p>
                    <Input
                      type="number"
                      value={config.feedPollMs}
                      onChange={(e) => {
                        setConfig(prev => prev ? { ...prev, feedPollMs: Number(e.target.value) } : prev);
                        setConfigChanged(true);
                      }}
                      className="bg-neutral-600 mt-2"
                      min={100}
                    />
                  </div>

                  <div>
                    <Label className="text-base font-medium">Stale Threshold (ms)</Label>
                    <p className="text-xs text-gray-400 mt-1">Quotes older than this are marked stale</p>
                    <Input
                      type="number"
                      value={config.staleThresholdMs}
                      onChange={(e) => {
                        setConfig(prev => prev ? { ...prev, staleThresholdMs: Number(e.target.value) } : prev);
                        setConfigChanged(true);
                      }}
                      className="bg-neutral-600 mt-2"
                      min={1000}
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
              </CardContent>
            </Card>

            <MarketDataProvidersCard />
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
                <div className="flex justify-between items-center py-3 border-b border-gray-600">
                  <div>
                    <Label className="text-base font-medium">Enforce Signup CAPTCHA</Label>
                    <p className="text-xs text-gray-400 mt-1">Require human verification on account creation.</p>
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
                  <Label className="text-base font-medium">Captcha Provider</Label>
                  <p className="text-xs text-gray-400 mt-1">Choose the verification provider for signup flow.</p>
                  <Select
                    value={config.captchaProvider}
                    onValueChange={(val) => {
                      setConfig(prev => prev ? { ...prev, captchaProvider: val } : prev);
                      setConfigChanged(true);
                    }}
                  >
                    <SelectTrigger className="bg-neutral-600 mt-2">
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
                  <div>
                    <Label className="text-base font-medium">Require Phone on Signup</Label>
                    <p className="text-xs text-gray-400 mt-1">Require valid phone number during account registration.</p>
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
                  <div>
                    <Label className="text-base font-medium">Enforce Legal Coverage Gate</Label>
                    <p className="text-xs text-gray-400 mt-1">Block signup where coverage is restricted or missing.</p>
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

        {/* CONTROLS */}
        <TabsContent value="controls">
          <div className="space-y-4">
            <Card className="bg-neutral-700 border-gray-600">
              <CardHeader>
                <CardTitle className="text-base">Regional Preferences</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between py-3 border-b border-gray-600">
                  <div>
                    <Label className="text-base font-medium">Allow users to edit timezone</Label>
                    <p className="text-xs text-gray-400 mt-1">
                      When disabled, timezone is read-only in Profile Settings. Language remains editable.
                    </p>
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
                  <div>
                    <Label className="text-base font-medium">Enable Remember Me</Label>
                    <p className="text-xs text-gray-400 mt-1">
                      Global kill switch for persistent login tokens.
                    </p>
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
                    <Label className="text-sm font-medium">Remember Me Max Age (days)</Label>
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
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Max Devices Per User</Label>
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
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Re-auth After Absence (days)</Label>
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
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Session Cookie Max Age (hours)</Label>
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
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Session Idle Timeout (minutes)</Label>
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
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between py-3 border-t border-gray-600">
                  <div>
                    <Label className="text-base font-medium">Rotate Remember Tokens on Use</Label>
                    <p className="text-xs text-gray-400 mt-1">
                      Enables one-time token replay protection with rotation.
                    </p>
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
                  <div>
                    <Label className="text-base font-medium">Auto-Revoke All on Theft Detection</Label>
                    <p className="text-xs text-gray-400 mt-1">
                      Terminates all sessions and remembered devices when token theft is detected.
                    </p>
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
                  <div>
                    <Label className="text-base font-medium">Logout Clears All Device Tokens</Label>
                    <p className="text-xs text-gray-400 mt-1">
                      When disabled, explicit logout removes only the current device token.
                    </p>
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
                  <div>
                    <Label className="text-base font-medium">Enable Scout tab</Label>
                    <p className="text-xs text-gray-400 mt-1">
                      Controls visibility of the admin Scout workspace navigation. Keep enabled unless Scout should be
                      intentionally hidden.
                    </p>
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
              >
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-3">
                  <Label>Provider</Label>
                  <Select value={healthProviderKey} onValueChange={setHealthProviderKey}>
                    <SelectTrigger className="bg-neutral-600 mt-1">
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
                        className={`w-3 h-3 rounded-full mr-2 ${
                          healthProviderKey && health.feedProviderKey && healthProviderKey === health.feedProviderKey
                            ? (health.feedProviderConnected ? "bg-green-500" : "bg-red-500")
                            : healthProviderKey
                              ? (health.requestedProvider?.configUsable ? "bg-amber-500" : "bg-red-500")
                              : "bg-gray-500"
                        }`}
                      ></div>
                      <span className="font-medium">Provider Status</span>
                    </div>
                    <p
                      className={`text-lg ${
                        healthProviderKey && health.feedProviderKey && healthProviderKey === health.feedProviderKey
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
    lotPresetCards: "[1,5,10,25,50]",
    lotDropdownMax: 50,
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
              <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
                <h2 className="text-lg sm:text-xl font-semibold">User Management</h2>
                <div className="flex gap-2 flex-wrap">
                  <Button onClick={exportUsers} variant="csv" size="sm" className="text-xs sm:text-sm">
                    Export CSV
                  </Button>
                  <Button onClick={exportUsersJsonl} variant="jsonl" size="sm" className="text-xs sm:text-sm">
                    Export JSONL
                  </Button>
                </div>
              </div>

              {/* Mini-tabs for filtering */}
              <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-4 p-1 bg-neutral-700 rounded">
                <button
                  onClick={() => { setUserFilterTab("all"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "all" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  All ({users.length})
                </button>
                <button
                  onClick={() => { setUserFilterTab("active"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "active" ? "bg-green-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  Active ({users.filter(u => !u.isDisabled && !u.isFrozen).length})
                </button>
                <button
                  onClick={() => { setUserFilterTab("disabled"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "disabled" ? "bg-red-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  Disabled ({users.filter(u => u.isDisabled).length})
                </button>
                <button
                  onClick={() => { setUserFilterTab("frozen"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "frozen" ? "bg-blue-500 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  Frozen ({users.filter(u => u.isFrozen && !u.isDisabled).length})
                </button>
                <button
                  onClick={() => { setUserFilterTab("online"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "online" ? "bg-cyan-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  <span className="hidden sm:inline">Online ({onlineData?.onlineCount || 0}) / Offline ({onlineData?.offlineCount || 0})</span>
                  <span className="sm:hidden">On/Off ({onlineData?.onlineCount || 0}/{onlineData?.offlineCount || 0})</span>
                </button>
                <button
                  onClick={() => { setUserFilterTab("logins"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "logins" ? "bg-purple-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  <span className="hidden sm:inline">Login History</span>
                  <span className="sm:hidden">Logins</span>
                </button>
                <button
                  onClick={() => { setUserFilterTab("audit"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "audit" ? "bg-orange-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  <span className="hidden sm:inline">Audit Trail</span>
                  <span className="sm:hidden">Audit</span>
                </button>
                <button
                  onClick={() => { setUserFilterTab("kyc"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "kyc" ? "bg-teal-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  KYC Queue
                </button>
                <button
                  onClick={() => { setUserFilterTab("grift"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "grift" ? "bg-red-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  <span className="hidden sm:inline">Grift Detection ({griftSummary?.openAlerts || 0})</span>
                  <span className="sm:hidden">Grift ({griftSummary?.openAlerts || 0})</span>
                </button>
                <button
                  onClick={() => { setUserFilterTab("activity"); setSelectedUserIds([]); }}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "activity" ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                >
                  Activity
                </button>
              </div>

              {userFilterTab !== "logins" && userFilterTab !== "online" && userFilterTab !== "audit" && userFilterTab !== "kyc" && userFilterTab !== "grift" && userFilterTab !== "activity" && selectedUserIds.length > 0 && (
                <div className="bg-neutral-700 p-3 rounded mb-4 flex items-center gap-4 flex-wrap">
                  <span className="text-sm">{selectedUserIds.length} user(s) selected</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkToggleStatusMutation.isPending}
                    onClick={() => bulkToggleStatusMutation.mutate({ userIds: selectedUserIds, disabled: true })}
                    className="bg-amber-600 hover:bg-amber-700 border-0"
                  >
                    {bulkToggleStatusMutation.isPending ? 'Processing...' : 'Disable Selected'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkToggleStatusMutation.isPending}
                    onClick={() => bulkToggleStatusMutation.mutate({ userIds: selectedUserIds, disabled: false })}
                    className="bg-green-600 hover:bg-green-700 border-0"
                  >
                    {bulkToggleStatusMutation.isPending ? 'Processing...' : 'Enable Selected'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedUserIds([])}>
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
                            <TableHead className="py-3 px-4 text-left text-gray-400">Session Duration</TableHead>
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
                    <Table className="border-collapse">
                      <TableHeader>
                        <TableRow className="border-b border-gray-700">
                          <TableHead className="py-3 px-4 text-left text-gray-400">User</TableHead>
                          <TableHead className="py-3 px-4 text-left text-gray-400">IP Address</TableHead>
                          <TableHead className="py-3 px-4 text-left text-gray-400">User Agent</TableHead>
                          <TableHead className="py-3 px-4 text-left text-gray-400">Status</TableHead>
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
                          >
                            {filter.label}
                          </button>
                        ))}
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
                        <h3 className="text-lg font-semibold text-teal-400 mb-2">Contender Pipeline</h3>
                        <p className="text-sm text-gray-400">
                          Users who meet performance criteria (P1: {policySummary?.policyContenderPath1MinAgeDays ?? 30}+ days, {Math.round((policySummary?.policyContenderPath1MinBalancePct ?? 1.2) * 100)}%+ balance, {policySummary?.policyContenderPath1MinTradesLifetime ?? 30}+ trades)
                          or (P2: {policySummary?.policyContenderPath2MinAgeDays ?? 90}+ days, {Math.round((policySummary?.policyContenderPath2MinReturnLast90 ?? 0.1) * 100)}%+ last-{path2WindowDays}d return, {policySummary?.policyContenderPath2MinTradesLast90 ?? 20}+ trades, last trade within {policySummary?.policyContenderPath2MaxDaysSinceLastTrade ?? 14} days)
                          will appear here for KYC/funding consideration.
                        </p>
                      </div>

                      <Card className="bg-neutral-700 border-gray-600">
                        <CardHeader>
                          <CardTitle className="text-base">Policy Controls</CardTitle>
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
                                      <Label className="text-green-500">Min Age (days)</Label>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyContenderPath1MinAgeDays}
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
                                      <Label className="text-green-500">Min Trades (lifetime)</Label>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyContenderPath1MinTradesLifetime}
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
                                      <Label className="text-green-500">Min Balance Multiplier (1.20 = 120%)</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={policyConfig.policyContenderPath1MinBalancePct}
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
                                      <Label className="text-teal-400">Min Age (days)</Label>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyContenderPath2MinAgeDays}
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
                                      <Label className="text-teal-400">Min Trades (last {path2WindowDays}d)</Label>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyContenderPath2MinTradesLast90}
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
                                      <Label className="text-teal-400">Min Return (0.10 = 10%)</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={policyConfig.policyContenderPath2MinReturnLast90}
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
                                      <Label className="text-teal-400">Max Days Since Last Trade</Label>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyContenderPath2MaxDaysSinceLastTrade}
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
                                    <Label>Email Resend Cooldown (sec)</Label>
                                    <Input
                                      type="number"
                                      value={policyConfig.policyEmailResendCooldownSec}
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
                                    <Label>Email Daily Send Cap</Label>
                                    <Input
                                      type="number"
                                      value={policyConfig.policyEmailDailySendCap}
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
                                    <Label>SMS Resend Cooldown (sec)</Label>
                                    <Input
                                      type="number"
                                      value={policyConfig.policySmsResendCooldownSec}
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
                                    <Label>SMS Daily Send Cap</Label>
                                    <Input
                                      type="number"
                                      value={policyConfig.policySmsDailySendCap}
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
                                    <Label>OTP Max Attempts</Label>
                                    <Input
                                      type="number"
                                      value={policyConfig.policyOtpMaxAttempts}
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
                                    <Label>OTP Lock Minutes</Label>
                                    <Input
                                      type="number"
                                      value={policyConfig.policyOtpLockMinutes}
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
                                  <div className="text-sm font-medium">Auto-promote Performer</div>
                                  <div className="text-xs text-gray-400">Automatically label eligible traders as PERFORMER.</div>
                                </div>
                                <Switch
                                  checked={Boolean(policyConfig.policyAutoPromotePerformer)}
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
                          <CardTitle className="text-base">KYC Candidates Queue</CardTitle>
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
                                <TableHead className="py-3 px-4 text-left text-gray-400">Actions</TableHead>
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
                                        >
                                          Invite KYC
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="text-xs bg-red-700 hover:bg-red-600 border-0"
                                          onClick={() => updateKycStatusMutation.mutate({ userId: candidate.userId, status: 'REJECTED' })}
                                          disabled={updateKycStatusMutation.isPending}
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
                  {/* Column visibility dropdown */}
                  <div className="flex justify-end mb-2">
                    <div className="relative group">
                      <Button variant="outline" size="sm" className="bg-neutral-700 text-xs">
                        Columns ▾
                      </Button>
                      <div className="absolute right-0 mt-1 w-48 bg-neutral-800 border border-gray-600 rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2 space-y-1">
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
                          <label key={col.key} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-neutral-700 p-1 rounded">
                            <Checkbox
                              checked={visibleColumns[col.key]}
                              onCheckedChange={(checked) => setVisibleColumns(prev => ({ ...prev, [col.key]: !!checked }))}
                            />
                            {col.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <Table className="border-collapse">
                      <TableHeader>
                        <TableRow className="border-b border-gray-700">
                          <TableHead className="py-3 px-2 w-10">
                            <Checkbox
                              checked={selectedUserIds.length > 0 && selectedUserIds.length === filteredUsers.length}
                              onCheckedChange={(checked) => handleSelectAll(!!checked)}
                            />
                          </TableHead>
                          {visibleColumns.name && (
                            <TableHead className="py-2 px-4 text-left text-gray-400">
                              <div className="space-y-1">
                                <span>Names</span>
                                <Input
                                  placeholder="Search..."
                                  value={columnFilters.name}
                                  onChange={(e) => setColumnFilters(prev => ({ ...prev, name: e.target.value }))}
                                  className="h-7 text-xs bg-neutral-700 w-full"
                                />
                              </div>
                            </TableHead>
                          )}
                          {visibleColumns.phone && (
                            <TableHead className="py-2 px-4 text-left text-gray-400">
                              <div className="space-y-1">
                                <span>Phone</span>
                                <Input
                                  placeholder="Search..."
                                  value={columnFilters.phone}
                                  onChange={(e) => setColumnFilters(prev => ({ ...prev, phone: e.target.value }))}
                                  className="h-7 text-xs bg-neutral-700 w-full"
                                />
                              </div>
                            </TableHead>
                          )}
                          {visibleColumns.username && (
                            <TableHead className="py-2 px-4 text-left text-gray-400">
                              <div className="space-y-1">
                                <span>Username</span>
                                <Input
                                  placeholder="Search..."
                                  value={columnFilters.username}
                                  onChange={(e) => setColumnFilters(prev => ({ ...prev, username: e.target.value }))}
                                  className="h-7 text-xs bg-neutral-700 w-full"
                                />
                              </div>
                            </TableHead>
                          )}
                          {visibleColumns.email && (
                            <TableHead className="py-2 px-4 text-left text-gray-400">
                              <div className="space-y-1">
                                <span>Email</span>
                                <Input
                                  placeholder="Search..."
                                  value={columnFilters.email}
                                  onChange={(e) => setColumnFilters(prev => ({ ...prev, email: e.target.value }))}
                                  className="h-7 text-xs bg-neutral-700 w-full"
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
                          {visibleColumns.leaderboard && <TableHead className="py-3 px-4 text-left text-gray-400">Leaderboard</TableHead>}
                          <TableHead className="py-3 px-4 text-left text-gray-400">Actions</TableHead>
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
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openTimeline(user)}
                                    className="bg-neutral-700 hover:bg-neutral-600 h-7 text-xs px-2"
                                  >
                                    Timeline
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openNotes(user)}
                                    className="bg-neutral-700 hover:bg-neutral-600 h-7 text-xs px-2"
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
                                      >
                                        {unfreezeUserMutation.isPending ? '...' : 'Unfreeze'}
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toggleUserStatusMutation.mutate({ userId: user.id, disabled: true })}
                                        disabled={toggleUserStatusMutation.isPending}
                                        className="bg-red-600 hover:bg-red-700 border-0 h-7 text-xs px-2"
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
                                      >
                                        Freeze
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toggleUserStatusMutation.mutate({ userId: user.id, disabled: true })}
                                        disabled={toggleUserStatusMutation.isPending}
                                        className="bg-red-600 hover:bg-red-700 border-0 h-7 text-xs px-2"
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
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="view-as" className="p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">View as Trader</h2>
              </div>
              <p className="text-gray-400 mb-4">
                Select a trader to view the platform from their perspective. This is useful for debugging and support purposes.
                All impersonation actions are logged for audit compliance.
              </p>

              <div className="mb-4">
                <Input
                  placeholder="Search by name, email, username, or phone..."
                  value={columnFilters.email}
                  onChange={(e) => setColumnFilters(prev => ({ ...prev, email: e.target.value }))}
                  className="max-w-md bg-neutral-700 border-gray-600"
                />
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
                      <TableHead className="text-gray-300">Action</TableHead>
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
            </TabsContent>

            <TabsContent value="trades" className="p-4">
              <h2 className="text-xl font-semibold mb-4">Trade Settings</h2>
              <p className="text-gray-400">Configure global trade parameters, risk management, and trading hours.</p>

              {/* This would be populated with trade settings controls */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
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
                          <Label>Opening Time (UTC)</Label>
                          <Input
                            type="time"
                            value={riskParams.marketOpenTime}
                            onChange={(e) => handleRiskParamChange('marketOpenTime', e.target.value)}
                            className="bg-neutral-600"
                          />
                        </div>
                        <div>
                          <Label>Closing Time (UTC)</Label>
                          <Input
                            type="time"
                            value={riskParams.marketCloseTime}
                            onChange={(e) => handleRiskParamChange('marketCloseTime', e.target.value)}
                            className="bg-neutral-600"
                          />
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="weekend"
                          checked={riskParams.allowWeekendTrading}
                          onCheckedChange={(checked) => handleRiskParamChange('allowWeekendTrading', Boolean(checked))}
                        />
                        <Label htmlFor="weekend">Allow weekend trading</Label>
                      </div>
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
                        <Label>Default Leverage</Label>
                        <Input
                          type="number"
                          value={riskParams.defaultLeverage}
                          onChange={(e) => handleRiskParamChange('defaultLeverage', Number(e.target.value))}
                          className="bg-neutral-600"
                        />
                      </div>
                      <div>
                        <Label>Max Position Size</Label>
                        <Input
                          type="number"
                          value={riskParams.maxPositionSize}
                          onChange={(e) => handleRiskParamChange('maxPositionSize', Number(e.target.value))}
                          className="bg-neutral-600"
                        />
                      </div>
                      <div>
                        <Label>Maximum Trades Per User</Label>
                        <Input
                          type="number"
                          value={riskParams.maxTradesPerUser}
                          onChange={(e) => handleRiskParamChange('maxTradesPerUser', Number(e.target.value))}
                          className="bg-neutral-600"
                        />
                        <p className="text-xs text-gray-400 mt-1">Maximum number of concurrent trades allowed per user</p>
                      </div>
                      <div>
                        <Label>Maximum Trades Per Instrument</Label>
                        <Input
                          type="number"
                          value={riskParams.maxTradesPerInstrument}
                          onChange={(e) => handleRiskParamChange('maxTradesPerInstrument', Number(e.target.value))}
                          className="bg-neutral-600"
                        />
                        <p className="text-xs text-gray-400 mt-1">Maximum number of concurrent trades allowed per instrument</p>
                      </div>
                      <div>
                        <Label>Maximum Concurrent Lots Per User</Label>
                        <Input
                          type="number"
                          value={riskParams.maxConcurrentLots}
                          onChange={(e) => handleRiskParamChange('maxConcurrentLots', Number(e.target.value))}
                          className="bg-neutral-600"
                        />
                        <p className="text-xs text-gray-400 mt-1">Maximum total lots allowed across all open trades per user</p>
                      </div>
                      <div>
                        <Label>Minimum Price Distance (pips)</Label>
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
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="enableAutoClose"
                          checked={riskParams.enableAutoClose}
                          onCheckedChange={(checked) => handleRiskParamChange('enableAutoClose', checked)}
                        />
                        <Label htmlFor="enableAutoClose" className="text-sm">Enable auto-close for trades</Label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <Label>Auto-close after (days)</Label>
                          <Input
                            type="number"
                            value={riskParams.autoCloseAfterDays}
                            onChange={(e) => handleRiskParamChange('autoCloseAfterDays', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Trades will auto-close after this many days</p>
                        </div>
                        <div>
                          <Label>Check frequency (minutes)</Label>
                          <Input
                            type="number"
                            value={riskParams.autoCloseCheckFrequencyMinutes}
                            onChange={(e) => handleRiskParamChange('autoCloseCheckFrequencyMinutes', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">How often the system checks for trades to close</p>
                        </div>
                        <div>
                          <Label>Minimum Hold Time (seconds)</Label>
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
                      <div className="flex items-center space-x-2 mb-4">
                        <Switch
                          id="enableLossLimits"
                          checked={riskParams.enableLossLimits}
                          onCheckedChange={(checked) => handleRiskParamChange('enableLossLimits', checked)}
                        />
                        <Label htmlFor="enableLossLimits" className="text-sm">Enable loss limit protection</Label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label>Daily Loss Limit (%)</Label>
                          <Input
                            type="number"
                            value={riskParams.dailyLossLimitPct}
                            onChange={(e) => handleRiskParamChange('dailyLossLimitPct', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Maximum daily loss as percentage of initial balance</p>
                        </div>
                        <div>
                          <Label>Lifetime Loss Limit (%)</Label>
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
                        <Label className="text-sm font-medium">Lot Preset Cards</Label>
                        <p className="text-xs text-gray-400 mb-3">Quick-select buttons shown to traders on the order form</p>
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
                          <Label>Dropdown Maximum Lots</Label>
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
            </TabsContent>

            <TabsContent value="instruments" className="p-4">
              <Tabs value={instrumentsSubTab} onValueChange={(v) => setInstrumentsSubTab(v as any)} className="space-y-4">
                <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-3 gap-1">
                  <TabsTrigger value="configured" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Configured</TabsTrigger>
                  <TabsTrigger value="ingestor" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Ingestor</TabsTrigger>
                  <TabsTrigger value="quoteSubscriptions" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Quote Subscriptions</TabsTrigger>
                </TabsList>

                <TabsContent value="configured">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">Trading Instruments</h2>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="bg-neutral-700 hover:bg-neutral-600"
                        onClick={() => setCatalogEnableDialogOpen(true)}
                      >
                        Add From Catalog
                      </Button>
                      <Button
                        variant="default"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => setNewSymbolDialogOpen(true)}
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
                                      >
                                        Edit
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => confirmDeleteSymbol(symbol.id)}
                                        className="bg-red-800 hover:bg-red-700 border-red-700"
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
                                      >
                                        Edit
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => confirmDeleteSymbol(symbol.id)}
                                        className="bg-red-800 hover:bg-red-700 border-red-700"
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
          <DialogHeader>
            <DialogTitle>Edit Trading Instrument: {editingSymbol?.symbol}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="symbol">Symbol</Label>
                <div className="pt-1">
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
                <p className="text-xs text-gray-400 mt-1">Type to search (e.g. EURUSD, "gold", etc.)</p>
              </div>

              <div>
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  value={editingSymbol?.name || ''}
                  onChange={(e) => handleSymbolChange("name", e.target.value)}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">User-friendly name for the instrument</p>
              </div>

              <div>
                <Label>Category</Label>
                <Select
                  value={editingSymbol?.category || ''}
                  onValueChange={(val) => handleSymbolChange("category", val)}
                >
                  <SelectTrigger className="bg-neutral-700 mt-1">
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
                <p className="text-xs text-gray-400 mt-1">Used to apply pip defaults during ingestion and for UI formatting.</p>
              </div>

              <div>
                <Label htmlFor="minSpreadPips">Minimum Spread (pips)</Label>
                <Input
                  id="minSpreadPips"
                  type="number"
                  step="0.1"
                  value={editingSymbol?.minSpreadPips || 2}
                  onChange={(e) => handleSymbolChange("minSpreadPips", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Minimum spread in pips (2.0 recommended)</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="baseCurrency">Base Currency</Label>
                  <Input
                    id="baseCurrency"
                    value={editingSymbol?.baseCurrency || ''}
                    onChange={(e) => handleSymbolChange("baseCurrency", e.target.value)}
                    className="bg-neutral-700"
                  />
                </div>
                <div>
                  <Label htmlFor="quoteCurrency">Quote Currency</Label>
                  <Input
                    id="quoteCurrency"
                    value={editingSymbol?.quoteCurrency || ''}
                    onChange={(e) => handleSymbolChange("quoteCurrency", e.target.value)}
                    className="bg-neutral-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="pipDecimals">Pip Decimals</Label>
                  <Input
                    id="pipDecimals"
                    type="number"
                    min={0}
                    max={12}
                    value={editingSymbol?.pipDecimals ?? ""}
                    onChange={(e) =>
                      handleSymbolChange("pipDecimals", e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="bg-neutral-700"
                  />
                  <p className="text-xs text-gray-400 mt-1">pip size = 10^-pipDecimals (e.g. 4 → 0.0001)</p>
                </div>
                <div>
                  <Label htmlFor="quoteDecimals">Quote Decimals</Label>
                  <Input
                    id="quoteDecimals"
                    type="number"
                    min={0}
                    max={12}
                    value={editingSymbol?.quoteDecimals ?? ""}
                    onChange={(e) =>
                      handleSymbolChange("quoteDecimals", e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="bg-neutral-700"
                  />
                  <p className="text-xs text-gray-400 mt-1">Formatting/rounding hint (e.g. 5 for FX, 3 for JPY FX)</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="minLot">Min Lot Size</Label>
                  <Input
                    id="minLot"
                    type="number"
                    value={editingSymbol?.minLot || 1}
                    onChange={(e) => handleSymbolChange("minLot", Number(e.target.value))}
                    className="bg-neutral-700"
                  />
                  <p className="text-xs text-gray-400 mt-1">Minimum lots allowed (1 lot = $100,000)</p>
                </div>
                <div>
                  <Label htmlFor="maxLot">Max Lot Size</Label>
                  <Input
                    id="maxLot"
                    type="number"
                    value={editingSymbol?.maxLot || 50}
                    onChange={(e) => handleSymbolChange("maxLot", Number(e.target.value))}
                    className="bg-neutral-700"
                  />
                  <p className="text-xs text-gray-400 mt-1">Maximum lots allowed (1-50)</p>
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-4">
                <Switch
                  id="enabled"
                  checked={editingSymbol?.enabled}
                  onCheckedChange={(checked) => handleSymbolChange("enabled", Boolean(checked))}
                />
                <Label htmlFor="enabled">Enabled for Trading</Label>
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
        </DialogContent>
      </Dialog>

      <InstrumentCatalogEnableDialog open={catalogEnableDialogOpen} onOpenChange={setCatalogEnableDialogOpen} />

      {/* New Symbol Dialog */}
      <Dialog open={newSymbolDialogOpen} onOpenChange={setNewSymbolDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add New Trading Instrument</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="new-symbol">Symbol</Label>
                <div className="pt-1">
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
                <p className="text-xs text-gray-400 mt-1">Type to search (e.g. EURUSD, "gold", etc.)</p>
              </div>

              <div>
                <Label htmlFor="new-name">Display Name</Label>
                <Input
                  id="new-name"
                  value={newSymbol.name}
                  onChange={(e) => handleNewSymbolChange("name", e.target.value)}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">User-friendly name for the instrument</p>
              </div>

              <div>
                <Label>Category</Label>
                <Select
                  value={(newSymbol.category as string) || ''}
                  onValueChange={(val) => handleNewSymbolChange("category", val)}
                >
                  <SelectTrigger className="bg-neutral-700 mt-1">
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
                <p className="text-xs text-gray-400 mt-1">Used to apply pip defaults during ingestion and for UI formatting.</p>
              </div>

              <div>
                <Label htmlFor="new-minSpreadPips">Minimum Spread (pips)</Label>
                <Input
                  id="new-minSpreadPips"
                  type="number"
                  step="0.1"
                  value={newSymbol.minSpreadPips}
                  onChange={(e) => handleNewSymbolChange("minSpreadPips", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Minimum spread in pips (2.0 recommended)</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="new-baseCurrency">Base Currency</Label>
                  <Input
                    id="new-baseCurrency"
                    value={newSymbol.baseCurrency}
                    onChange={(e) => handleNewSymbolChange("baseCurrency", e.target.value)}
                    className="bg-neutral-700"
                  />
                </div>
                <div>
                  <Label htmlFor="new-quoteCurrency">Quote Currency</Label>
                  <Input
                    id="new-quoteCurrency"
                    value={newSymbol.quoteCurrency}
                    onChange={(e) => handleNewSymbolChange("quoteCurrency", e.target.value)}
                    className="bg-neutral-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="new-pipDecimals">Pip Decimals</Label>
                  <Input
                    id="new-pipDecimals"
                    type="number"
                    min={0}
                    max={12}
                    value={newSymbol.pipDecimals ?? ""}
                    onChange={(e) =>
                      handleNewSymbolChange("pipDecimals", e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="bg-neutral-700"
                  />
                  <p className="text-xs text-gray-400 mt-1">pip size = 10^-pipDecimals (e.g. 4 → 0.0001)</p>
                </div>
                <div>
                  <Label htmlFor="new-quoteDecimals">Quote Decimals</Label>
                  <Input
                    id="new-quoteDecimals"
                    type="number"
                    min={0}
                    max={12}
                    value={newSymbol.quoteDecimals ?? ""}
                    onChange={(e) =>
                      handleNewSymbolChange("quoteDecimals", e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="bg-neutral-700"
                  />
                  <p className="text-xs text-gray-400 mt-1">Formatting/rounding hint (e.g. 5 for FX, 3 for JPY FX)</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="new-minLot">Min Lot Size</Label>
                  <Input
                    id="new-minLot"
                    type="number"
                    value={newSymbol.minLot}
                    onChange={(e) => handleNewSymbolChange("minLot", Number(e.target.value))}
                    className="bg-neutral-700"
                  />
                  <p className="text-xs text-gray-400 mt-1">Minimum lots allowed (1 lot = $100,000)</p>
                </div>
                <div>
                  <Label htmlFor="new-maxLot">Max Lot Size</Label>
                  <Input
                    id="new-maxLot"
                    type="number"
                    value={newSymbol.maxLot}
                    onChange={(e) => handleNewSymbolChange("maxLot", Number(e.target.value))}
                    className="bg-neutral-700"
                  />
                  <p className="text-xs text-gray-400 mt-1">Maximum lots allowed (1-50)</p>
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-4">
                <Switch
                  id="new-enabled"
                  checked={newSymbol.enabled}
                  onCheckedChange={(checked) => handleNewSymbolChange("enabled", Boolean(checked))}
                />
                <Label htmlFor="new-enabled">Enabled for Trading</Label>
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
