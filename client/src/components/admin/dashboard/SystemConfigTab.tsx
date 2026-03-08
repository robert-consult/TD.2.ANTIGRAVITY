import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import SignupFreezeWaitlistCard from "@/components/admin/SignupFreezeWaitlistCard";
import { JurisdictionControlsCard } from "@/components/admin/JurisdictionControlsCard";
import { MarketDataProvidersCard } from "@/components/admin/MarketDataProvidersCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { mergeGlobalSettingsPerformance, resolveGlobalPerformanceSettingsPayload } from "@/lib/globalSettingsPerformance";
import { PERFORMANCE_TIERS } from "@/lib/perfHints";
import {
  CONTROLS_FIELD_HELP,
  DEFAULT_MARKET_PERFORMANCE_SETTINGS,
  FieldHintLabel,
  FxRolloverSettings,
  MARKET_DATA_QUOTE_FIELD_HELP,
  MARKET_PERFORMANCE_FIELD_HELP,
  MARKET_PERFORMANCE_TIER_HELP,
  MARKET_PERFORMANCE_TIER_TABLE_HELP,
  SIGNUP_COMPLIANCE_FIELD_HELP,
  SYSTEM_HEALTH_FIELD_HELP,
  SYSTEM_I18N_FIELD_HELP,
  TIER_FLUSH_SETTING_KEYS,
  TIER_POLL_SETTING_KEYS,
  TRADING_CONTROLS_FIELD_HELP,
  marketPerformanceSettingsEqual,
  parseLocaleCsvInput,
  resolveI18nAdminConfig,
  resolveMarketPerformanceSettings,
  type GlobalSettings,
  type I18nAdminConfigData,
  type MarketDataProvidersResp,
  type MarketPerformanceSettings,
  type SystemConfigData,
  type SystemConfigSaveSection,
  type SystemHealthData,
} from "./AdminDashboardSupport";
import { MigrationTab } from "./MigrationTab";
import { SystemHealthPanel } from "./SystemHealthPanel";

export function SystemConfigTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [subTab, setSubTab] = useState("trading");
  const [config, setConfig] = useState<SystemConfigData | null>(null);
  const [, setConfigChanged] = useState(false);
  const [i18nConfig, setI18nConfig] = useState<I18nAdminConfigData | null>(null);
  const [i18nLocalesCsv, setI18nLocalesCsv] = useState("en");
  const [i18nChanged, setI18nChanged] = useState(false);
  const [marketPerfSettings, setMarketPerfSettings] = useState<MarketPerformanceSettings>(
    DEFAULT_MARKET_PERFORMANCE_SETTINGS,
  );
  const [marketPerfChanged, setMarketPerfChanged] = useState(false);
  const marketPerfSyncGuardRef = useRef<MarketPerformanceSettings | null>(null);
  const marketPerfSchemaWarningRef = useRef(false);
  const [pendingSystemConfigSection, setPendingSystemConfigSection] = useState<SystemConfigSaveSection | null>(null);
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

  const sectionChanged = (...keys: (keyof SystemConfigData)[]) => {
    if (!config || !systemConfig) return false;
    return keys.some((key) => config[key] !== systemConfig[key]);
  };

  const isTradingControlsChanged = sectionChanged(
    "maintenanceMode",
    "tradingHalt",
    "closeOnlyMode",
    "blockOpenOnStaleQuotes",
    "maintenanceMessage",
  );

  const isMarketDataSettingsChanged = sectionChanged(
    "quoteRefreshMs",
    "feedPollMs",
    "staleThresholdMs",
    "fxRolloverTz",
    "fxRolloverTime",
  );

  const isSignupComplianceChanged = sectionChanged(
    "signupCaptchaEnforce",
    "captchaProvider",
    "signupPhoneEnforce",
    "legalCoverageEnforce",
  );

  const isSignupFreezeWaitlistChanged = sectionChanged(
    "signupFreeze",
    "signupFreezeMessage",
    "signupWaitlistEnabled",
    "signupWaitlistInviteSender",
    "signupWaitlistInviteSubject",
    "signupWaitlistInviteBodyText",
    "signupWaitlistAutoInviteOnUnfreeze",
    "signupWaitlistInviteBatchCap",
    "signupWaitlistPolicyVersion",
    "signupWaitlistPolicyContent",
  );

  const isJurisdictionControlsChanged = sectionChanged(
    "jurisdictionRestrictedIso2Csv",
    "jurisdictionRestrictedMessage",
    "jurisdictionEnforceByIpGeo",
    "jurisdictionEnforceBySignupCountry",
    "jurisdictionBlockSignup",
    "jurisdictionBlockLogin",
  );

  const isSessionAndAccessControlsChanged = sectionChanged(
    "allowUserTimezoneEdit",
    "rememberMeEnabled",
    "rememberMeMaxAgeDays",
    "rememberMeMaxDevicesPerUser",
    "rememberMeReauthAfterAbsenceDays",
    "sessionCookieMaxAgeHours",
    "sessionIdleTimeoutMinutes",
    "rememberMeTokenRotationEnabled",
    "rememberMeTheftAutoRevokeAll",
    "logoutClearAllDeviceTokens",
    "scoutTabEnabled",
  );

  const hasSystemConfigUnsavedChanges =
    isTradingControlsChanged ||
    isMarketDataSettingsChanged ||
    isSignupComplianceChanged ||
    isSignupFreezeWaitlistChanged ||
    isJurisdictionControlsChanged ||
    isSessionAndAccessControlsChanged;

  useEffect(() => {
    if (systemConfig && !hasSystemConfigUnsavedChanges) {
      setConfig(systemConfig);
    }
  }, [systemConfig, hasSystemConfigUnsavedChanges]);

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
    mutationFn: async (payload: { settings: MarketPerformanceSettings; expectedUpdatedAt: number }) => {
      const refreshed = await axios.put("/api/admin/global-settings", {
        ...payload.settings,
        expectedUpdatedAt: payload.expectedUpdatedAt,
      });
      return {
        requested: payload.settings,
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
    const expectedUpdatedAt = typeof globalPerformanceData?.updatedAt === "number" ? globalPerformanceData.updatedAt : null;
    if (expectedUpdatedAt === null) {
      toast({
        title: "Settings are stale",
        description: "Refresh global settings and try saving again.",
        variant: "destructive",
      });
      return;
    }
    updateMarketPerfMutation.mutate({ settings: { ...marketPerfSettings }, expectedUpdatedAt });
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

  const handleSaveSystemConfigSection = (
    section: SystemConfigSaveSection,
    payload: Partial<SystemConfigData>,
    title: string,
    description: string,
  ) => {
    setPendingSystemConfigSection(section);
    updateMutation.mutate(payload, {
      onSuccess: () => {
        toast({ title, description });
      },
      onSettled: () => {
        setPendingSystemConfigSection((current) => (current === section ? null : current));
      },
    });
  };

  const handleSaveTradingControls = () => {
    if (!config) return;
    handleSaveSystemConfigSection(
      "trading",
      {
        maintenanceMode: config.maintenanceMode,
        tradingHalt: config.tradingHalt,
        closeOnlyMode: config.closeOnlyMode,
        blockOpenOnStaleQuotes: config.blockOpenOnStaleQuotes,
        maintenanceMessage: config.maintenanceMessage,
      },
      "Trading Controls Saved",
      "Safety switch and maintenance controls updated.",
    );
  };

  const handleSaveMarketDataSettings = () => {
    if (!config) return;
    handleSaveSystemConfigSection(
      "marketData",
      {
        quoteRefreshMs: config.quoteRefreshMs,
        feedPollMs: config.feedPollMs,
        staleThresholdMs: config.staleThresholdMs,
        fxRolloverTz: config.fxRolloverTz,
        fxRolloverTime: config.fxRolloverTime,
      },
      "Market Data Settings Saved",
      "Quote cadence and FX rollover defaults updated.",
    );
  };

  const handleSaveSignupCompliance = () => {
    if (!config) return;
    handleSaveSystemConfigSection(
      "signupCompliance",
      {
        signupCaptchaEnforce: config.signupCaptchaEnforce,
        captchaProvider: config.captchaProvider,
        signupPhoneEnforce: config.signupPhoneEnforce,
        legalCoverageEnforce: config.legalCoverageEnforce,
      },
      "Signup Compliance Saved",
      "Captcha, phone, and legal gating controls updated.",
    );
  };

  const handleSaveSignupFreezeWaitlist = () => {
    if (!config) return;
    handleSaveSystemConfigSection(
      "signupFreezeWaitlist",
      {
        signupFreeze: config.signupFreeze,
        signupFreezeMessage: config.signupFreezeMessage,
        signupWaitlistEnabled: config.signupWaitlistEnabled,
        signupWaitlistInviteSender: config.signupWaitlistInviteSender,
        signupWaitlistInviteSubject: config.signupWaitlistInviteSubject,
        signupWaitlistInviteBodyText: config.signupWaitlistInviteBodyText,
        signupWaitlistAutoInviteOnUnfreeze: config.signupWaitlistAutoInviteOnUnfreeze,
        signupWaitlistInviteBatchCap: config.signupWaitlistInviteBatchCap,
        signupWaitlistPolicyVersion: config.signupWaitlistPolicyVersion,
        signupWaitlistPolicyContent: config.signupWaitlistPolicyContent,
      },
      "Signup Freeze & Waitlist Saved",
      "Freeze, invite, and waitlist policy settings updated.",
    );
  };

  const handleSaveJurisdictionControls = () => {
    if (!config) return;
    handleSaveSystemConfigSection(
      "jurisdiction",
      {
        jurisdictionRestrictedIso2Csv: config.jurisdictionRestrictedIso2Csv,
        jurisdictionRestrictedMessage: config.jurisdictionRestrictedMessage,
        jurisdictionEnforceByIpGeo: config.jurisdictionEnforceByIpGeo,
        jurisdictionEnforceBySignupCountry: config.jurisdictionEnforceBySignupCountry,
        jurisdictionBlockSignup: config.jurisdictionBlockSignup,
        jurisdictionBlockLogin: config.jurisdictionBlockLogin,
      },
      "Jurisdiction Controls Saved",
      "Country restriction and enforcement controls updated.",
    );
  };

  const handleSaveSessionAndAccessControls = () => {
    if (!config) return;
    handleSaveSystemConfigSection(
      "sessionAndAccess",
      {
        allowUserTimezoneEdit: config.allowUserTimezoneEdit,
        rememberMeEnabled: config.rememberMeEnabled,
        rememberMeMaxAgeDays: config.rememberMeMaxAgeDays,
        rememberMeMaxDevicesPerUser: config.rememberMeMaxDevicesPerUser,
        rememberMeReauthAfterAbsenceDays: config.rememberMeReauthAfterAbsenceDays,
        sessionCookieMaxAgeHours: config.sessionCookieMaxAgeHours,
        sessionIdleTimeoutMinutes: config.sessionIdleTimeoutMinutes,
        rememberMeTokenRotationEnabled: config.rememberMeTokenRotationEnabled,
        rememberMeTheftAutoRevokeAll: config.rememberMeTheftAutoRevokeAll,
        logoutClearAllDeviceTokens: config.logoutClearAllDeviceTokens,
        scoutTabEnabled: config.scoutTabEnabled,
      },
      "Session & Access Controls Saved",
      "Regional, session, and Scout access controls updated.",
    );
  };

  const isTradingControlsSaving = pendingSystemConfigSection === "trading" && updateMutation.isPending;
  const isMarketDataSettingsSaving = pendingSystemConfigSection === "marketData" && updateMutation.isPending;
  const isSignupComplianceSaving = pendingSystemConfigSection === "signupCompliance" && updateMutation.isPending;
  const isSignupFreezeWaitlistSaving = pendingSystemConfigSection === "signupFreezeWaitlist" && updateMutation.isPending;
  const isJurisdictionControlsSaving = pendingSystemConfigSection === "jurisdiction" && updateMutation.isPending;
  const isSessionAndAccessControlsSaving = pendingSystemConfigSection === "sessionAndAccess" && updateMutation.isPending;

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
                    onClick={handleSaveTradingControls}
                    disabled={!isTradingControlsChanged || updateMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isTradingControlsSaving ? "Saving..." : "Save Changes"}
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
                      onClick={handleSaveMarketDataSettings}
                      disabled={!isMarketDataSettingsChanged || updateMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {isMarketDataSettingsSaving ? "Saving..." : "Save Changes"}
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
                      onClick={handleSaveSignupCompliance}
                      disabled={!isSignupComplianceChanged || updateMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {isSignupComplianceSaving ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>

            <SignupFreezeWaitlistCard
              config={config}
              setConfig={setConfig}
              setConfigChanged={setConfigChanged}
              onSave={handleSaveSignupFreezeWaitlist}
              saving={isSignupFreezeWaitlistSaving}
              canSave={isSignupFreezeWaitlistChanged}
            />

            {config && (
              <JurisdictionControlsCard
                config={config}
                setConfig={setConfig}
                setConfigChanged={setConfigChanged}
                configChanged={isJurisdictionControlsChanged}
                onSave={handleSaveJurisdictionControls}
                saving={isJurisdictionControlsSaving}
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
                  onClick={handleSaveSessionAndAccessControls}
                  disabled={!isSessionAndAccessControlsChanged || updateMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isSessionAndAccessControlsSaving ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </div>
          </TooltipProvider>
        </TabsContent>

        {/* MIGRATION */}
        <TabsContent value="migration">
          <MigrationTab />
        </TabsContent>

        <SystemHealthPanel
          healthProviderKey={healthProviderKey}
          setHealthProviderKey={setHealthProviderKey}
          refetchHealth={refetchHealth}
          providers={providers}
          activeProviderKey={providersData?.activeKey ?? null}
          health={health}
          probeProviderPending={probeProviderMutation.isPending}
          onProbeProvider={() => probeProviderMutation.mutate()}
        />
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
