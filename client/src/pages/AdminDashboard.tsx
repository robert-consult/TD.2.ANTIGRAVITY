import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo, useRef } from "react";
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
import { useAuth } from "@/hooks/use-auth";
import {
  mergeGlobalSettingsPerformance,
  resolveGlobalPerformanceSettingsPayload,
} from "@/lib/globalSettingsPerformance";
import { PERFORMANCE_TIERS, flushIntervalForTier, pollIntervalForTier } from "@/lib/perfHints";
import { useLocation } from "wouter";
import {
  FieldHintLabel,
  INSTRUMENTS_FIELD_HELP,
  parseUserAgent,
  TRADE_SETTINGS_FIELD_HELP,
  USER_MANAGEMENT_FIELD_HELP,
  VIEW_AS_TRADER_FIELD_HELP,
} from "@/components/admin/dashboard/AdminDashboardSupport";
import { AdminDashboardDialogs } from "@/components/admin/dashboard/AdminDashboardDialogs";
import { AdminInstrumentsTab } from "@/components/admin/dashboard/AdminInstrumentsTab";
import { AdminTradeSettingsTab } from "@/components/admin/dashboard/AdminTradeSettingsTab";
import { AdminUserManagementTab } from "@/components/admin/dashboard/AdminUserManagementTab";
import { AdminViewAsTab } from "@/components/admin/dashboard/AdminViewAsTab";
import { SystemConfigTab } from "@/components/admin/dashboard/SystemConfigTab";
import type {
  AdminNote,
  GlobalSettings,
  KycCandidate,
  LoginHistoryEntry,
  PolicyConfigData,
  SymbolConfig,
  SystemConfigData,
  TimelineEvent,
  TradeSettingsSaveSection,
  User,
  UserColumnKey,
  UserSettings,
} from "@/components/admin/dashboard/AdminDashboardSupport";

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { checkAuth } = useAuth();
  const [, navigate] = useLocation();
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
  const [auditEventFilter, setAuditEventFilter] = useState<
    "all" | "signup" | "login_success" | "login_fail" | "admin" | "identity" | "trade_audit" | "order_intent"
  >("all");

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
  const [riskParamsHydrated, setRiskParamsHydrated] = useState(false);
  const [pendingTradeSettingsSection, setPendingTradeSettingsSection] = useState<TradeSettingsSaveSection | null>(null);

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

  const isCapitalSettingsChanged = useMemo(() => {
    if (!globalSettingsData) return false;
    return (
      riskParams.defaultUserStartingBalanceUsd !== globalSettingsData.defaultUserStartingBalanceUsd ||
      riskParams.defaultUserStartingEquityUsd !== globalSettingsData.defaultUserStartingEquityUsd ||
      riskParams.defaultChallengeVirtualCapitalUsd !== globalSettingsData.defaultChallengeVirtualCapitalUsd
    );
  }, [riskParams, globalSettingsData]);

  const isMarketHoursChanged = useMemo(() => {
    if (!globalSettingsData) return false;
    return (
      riskParams.marketOpenTime !== globalSettingsData.marketOpenTime ||
      riskParams.marketCloseTime !== globalSettingsData.marketCloseTime ||
      riskParams.allowWeekendTrading !== globalSettingsData.allowWeekendTrading
    );
  }, [riskParams, globalSettingsData]);

  const isDefaultRiskParametersChanged = useMemo(() => {
    if (!globalSettingsData) return false;
    return (
      riskParams.defaultLeverage !== globalSettingsData.defaultLeverage ||
      riskParams.maxPositionSize !== globalSettingsData.maxPositionSize ||
      riskParams.maxTradesPerUser !== globalSettingsData.maxTradesPerUser ||
      riskParams.maxTradesPerInstrument !== globalSettingsData.maxTradesPerInstrument ||
      riskParams.maxConcurrentLots !== globalSettingsData.maxConcurrentLots ||
      riskParams.minPriceDistancePips !== globalSettingsData.minPriceDistancePips
    );
  }, [riskParams, globalSettingsData]);

  const isOperationalRiskAndLotSettingsChanged = useMemo(() => {
    if (!globalSettingsData) return false;
    return (
      riskParams.enableAutoClose !== globalSettingsData.enableAutoClose ||
      riskParams.autoCloseAfterDays !== globalSettingsData.autoCloseAfterDays ||
      riskParams.autoCloseCheckFrequencyMinutes !== globalSettingsData.autoCloseCheckFrequencyMinutes ||
      riskParams.minHoldSec !== globalSettingsData.minHoldSec ||
      riskParams.enableLossLimits !== globalSettingsData.enableLossLimits ||
      riskParams.dailyLossLimitPct !== globalSettingsData.dailyLossLimitPct ||
      riskParams.lifetimeLossLimitPct !== globalSettingsData.lifetimeLossLimitPct ||
      riskParams.lotPresetCards !== globalSettingsData.lotPresetCards ||
      riskParams.lotDropdownMax !== globalSettingsData.lotDropdownMax
    );
  }, [riskParams, globalSettingsData]);

  const hasRiskParamsUnsavedChanges =
    isCapitalSettingsChanged ||
    isMarketHoursChanged ||
    isDefaultRiskParametersChanged ||
    isOperationalRiskAndLotSettingsChanged;

  // Hydrate once from persisted global settings, then keep local form state in sync only when clean.
  useEffect(() => {
    if (!globalSettingsData) return;
    if (!riskParamsHydrated || !hasRiskParamsUnsavedChanges) {
      setRiskParams((prev) => {
        const raw = Number((globalSettingsData as any)?.minPriceDistancePips);
        const minPriceDistancePips = Number.isFinite(raw) ? Math.trunc(raw) : (prev.minPriceDistancePips ?? 20);
        return { ...prev, ...globalSettingsData, minPriceDistancePips };
      });
      setRiskParamsHydrated(true);
    }
  }, [globalSettingsData, hasRiskParamsUnsavedChanges, riskParamsHydrated]);

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
      queryClient.clear();
      navigate("/");
      void checkAuth().catch((error) => {
        console.error("Failed to refresh session after View As start:", error);
        window.location.assign("/");
      });
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

  const queueUserExport = async (format: "csv" | "jsonl" | "parquet") => {
    try {
      const response = await axios.post("/api/admin/data-exports/users", {
        format,
        filters: {
          limit: 500_000,
          includeAdmins: true,
          includeDeleted: true,
        },
      });
      const jobId = response?.data?.jobId;
      if (!jobId) throw new Error("Missing job ID");
      toast({
        title: response?.data?.deduped ? "Using existing export job" : "User export queued",
        description: `Job ID: ${jobId}`,
      });
    } catch (error: any) {
      toast({
        title: "Export queue failed",
        description: error?.response?.data?.message || error?.message || "Failed to queue user export",
        variant: "destructive",
      });
    }
  };

  const queueUserTimelineExport = async (format: "csv" | "jsonl" | "parquet") => {
    if (!timelineUser?.id) return;
    try {
      const response = await axios.post("/api/admin/data-exports/user-timeline", {
        format,
        filters: {
          userId: timelineUser.id,
          limit: 500_000,
        },
      });
      const jobId = response?.data?.jobId;
      if (!jobId) throw new Error("Missing job ID");
      toast({
        title: response?.data?.deduped ? "Using existing export job" : "Timeline export queued",
        description: `Job ID: ${jobId}`,
      });
    } catch (error: any) {
      toast({
        title: "Timeline export queue failed",
        description: error?.response?.data?.message || error?.message || "Failed to queue timeline export",
        variant: "destructive",
      });
    }
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
    logins: Array<{ id: number; userId?: number | null; email: string; success: boolean; ip: string | null; createdAt: number; sessionId?: string | null }>;
    adminActions: Array<{ id: number; adminId: number; userId: number; actionType: string; createdAt: number; metadata?: string; metadataJson?: Record<string, unknown> | null }>;
    identityEvents: Array<{ id: number; at: number; userId?: number | null; email?: string | null; type: string; category?: string | null; sessionId?: string | null; correlationId?: string | null; eventHash?: string | null }>;
    tradeAuditEvents: Array<{ id: number; eventAtSec?: number | null; eventType: string; correlationId?: string | null; tradeId?: number | null; orderId?: string | null; executionId?: string | null; positionId?: string | null; userEmail?: string | null; username?: string | null; riskResult?: string | null; reasonCode?: string | null; symbol?: string | null; side?: string | null; qtyLots?: number | null; sessionId?: string | null; ip?: string | null; userAgent?: string | null }>;
    orderIntentEvents: Array<{ id: number; eventAtSec?: number | null; eventCode: string; decision?: string | null; correlationId: string; userId?: number | null; userEmail?: string | null; username?: string | null; rejectCheck?: string | null; rejectReason?: string | null; symbol?: string | null; side?: string | null; qtyLots?: number | null; sessionId?: string | null; ip?: string | null; userAgent?: string | null }>;
  }>({
    queryKey: ["/api/admin/audit-trail"],
    queryFn: () => axios.get("/api/admin/audit-trail?limit=200&includeDeepTrade=1&includeLinkage=1").then(r => r.data),
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
    mutationFn: (payload: Partial<GlobalSettings> & { expectedUpdatedAt: number }) =>
      axios.put('/api/admin/global-settings', payload).then((r) => r.data as GlobalSettings),
    onSuccess: (persisted: GlobalSettings) => {
      queryClient.setQueryData(["/api/admin/global-settings"], persisted);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/global-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-settings"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.response?.data?.message || "Failed to save risk settings", variant: "destructive" });
    },
  });

  const handleRiskParamChange = (field: keyof GlobalSettings, value: number | string | boolean) => {
    setRiskParams(prev => ({ ...prev, [field]: value }));
  };

  const applyPersistedRiskParams = (section: TradeSettingsSaveSection, persisted: GlobalSettings) => {
    setRiskParams((prev) => {
      const nextUpdatedAt = persisted.updatedAt ?? prev.updatedAt;
      if (section === "capital") {
        return {
          ...prev,
          defaultUserStartingBalanceUsd: persisted.defaultUserStartingBalanceUsd,
          defaultUserStartingEquityUsd: persisted.defaultUserStartingEquityUsd,
          defaultChallengeVirtualCapitalUsd: persisted.defaultChallengeVirtualCapitalUsd,
          updatedAt: nextUpdatedAt,
        };
      }
      if (section === "marketHours") {
        return {
          ...prev,
          marketOpenTime: persisted.marketOpenTime,
          marketCloseTime: persisted.marketCloseTime,
          allowWeekendTrading: persisted.allowWeekendTrading,
          updatedAt: nextUpdatedAt,
        };
      }
      if (section === "defaultRisk") {
        return {
          ...prev,
          defaultLeverage: persisted.defaultLeverage,
          maxPositionSize: persisted.maxPositionSize,
          maxTradesPerUser: persisted.maxTradesPerUser,
          maxTradesPerInstrument: persisted.maxTradesPerInstrument,
          maxConcurrentLots: persisted.maxConcurrentLots,
          minPriceDistancePips: persisted.minPriceDistancePips,
          updatedAt: nextUpdatedAt,
        };
      }
      return {
        ...prev,
        enableAutoClose: persisted.enableAutoClose,
        autoCloseAfterDays: persisted.autoCloseAfterDays,
        autoCloseCheckFrequencyMinutes: persisted.autoCloseCheckFrequencyMinutes,
        minHoldSec: persisted.minHoldSec,
        enableLossLimits: persisted.enableLossLimits,
        dailyLossLimitPct: persisted.dailyLossLimitPct,
        lifetimeLossLimitPct: persisted.lifetimeLossLimitPct,
        lotPresetCards: persisted.lotPresetCards,
        lotDropdownMax: persisted.lotDropdownMax,
        updatedAt: nextUpdatedAt,
      };
    });
  };

  const handleSaveRiskParams = (
    section: TradeSettingsSaveSection,
    payload: Partial<GlobalSettings>,
    title: string,
    description: string,
  ) => {
    const expectedUpdatedAt =
      typeof globalSettingsData?.updatedAt === "number"
        ? globalSettingsData.updatedAt
        : typeof riskParams.updatedAt === "number"
          ? riskParams.updatedAt
          : null;
    if (expectedUpdatedAt === null) {
      toast({
        title: "Settings are stale",
        description: "Refresh global settings and try saving again.",
        variant: "destructive",
      });
      return;
    }

    setPendingTradeSettingsSection(section);
    globalSettingsMutation.mutate(
      { ...payload, expectedUpdatedAt },
      {
        onSuccess: (persisted) => {
          applyPersistedRiskParams(section, persisted);
          toast({
            title,
            description,
          });
        },
        onSettled: () => {
          setPendingTradeSettingsSection((current) => (current === section ? null : current));
        },
      },
    );
  };

  const handleSaveCapitalSettings = () =>
    handleSaveRiskParams(
      "capital",
      {
        defaultUserStartingBalanceUsd: riskParams.defaultUserStartingBalanceUsd,
        defaultUserStartingEquityUsd: riskParams.defaultUserStartingEquityUsd,
        defaultChallengeVirtualCapitalUsd: riskParams.defaultChallengeVirtualCapitalUsd,
      },
      "Capital Settings Saved",
      "Default account and challenge capital values updated.",
    );

  const handleSaveMarketHoursSettings = () =>
    handleSaveRiskParams(
      "marketHours",
      {
        marketOpenTime: riskParams.marketOpenTime,
        marketCloseTime: riskParams.marketCloseTime,
        allowWeekendTrading: riskParams.allowWeekendTrading,
      },
      "Market Hours Saved",
      "Trading session window and weekend policy updated.",
    );

  const handleSaveDefaultRiskSettings = () =>
    handleSaveRiskParams(
      "defaultRisk",
      {
        defaultLeverage: riskParams.defaultLeverage,
        maxPositionSize: riskParams.maxPositionSize,
        maxTradesPerUser: riskParams.maxTradesPerUser,
        maxTradesPerInstrument: riskParams.maxTradesPerInstrument,
        maxConcurrentLots: riskParams.maxConcurrentLots,
        minPriceDistancePips: riskParams.minPriceDistancePips,
      },
      "Risk Parameters Saved",
      "Default leverage and trade guardrails updated.",
    );

  const handleSaveOperationalRiskAndLotSettings = () =>
    handleSaveRiskParams(
      "operationalRiskAndLot",
      {
        enableAutoClose: riskParams.enableAutoClose,
        autoCloseAfterDays: riskParams.autoCloseAfterDays,
        autoCloseCheckFrequencyMinutes: riskParams.autoCloseCheckFrequencyMinutes,
        minHoldSec: riskParams.minHoldSec,
        enableLossLimits: riskParams.enableLossLimits,
        dailyLossLimitPct: riskParams.dailyLossLimitPct,
        lifetimeLossLimitPct: riskParams.lifetimeLossLimitPct,
        lotPresetCards: riskParams.lotPresetCards,
        lotDropdownMax: riskParams.lotDropdownMax,
      },
      "Operational Risk & Lot Settings Saved",
      "Auto-close, loss-limit, and lot presentation controls updated.",
    );

  const isCapitalSettingsSaving = pendingTradeSettingsSection === "capital" && globalSettingsMutation.isPending;
  const isMarketHoursSaving = pendingTradeSettingsSection === "marketHours" && globalSettingsMutation.isPending;
  const isDefaultRiskSaving = pendingTradeSettingsSection === "defaultRisk" && globalSettingsMutation.isPending;
  const isOperationalRiskAndLotSaving =
    pendingTradeSettingsSection === "operationalRiskAndLot" && globalSettingsMutation.isPending;

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

            <AdminUserManagementTab
              {...{
                queueUserExport,
                setUserFilterTab,
                setSelectedUserIds,
                userFilterTab,
                users,
                onlineData,
                selectedUserIds,
                bulkToggleStatusMutation,
                isLoadingOnline,
                allLoginHistory,
                isLoadingLoginHistory,
                auditTrailData,
                isLoadingAuditTrail,
                auditEventFilter,
                setAuditEventFilter,
                isLoadingKycQueue,
                policySummary,
                path2WindowDays,
                isLoadingPolicyConfig,
                policyConfig,
                setPolicyConfig,
                setPolicyConfigChanged,
                policyConfigChanged,
                policyConfigMutation,
                kycCandidates,
                inviteKycMutation,
                updateKycStatusMutation,
                griftSummary,
                isLoadingGriftSummary,
                isLoadingGriftUsers,
                isLoadingGriftAlerts,
                isLoading,
                visibleColumns,
                setVisibleColumns,
                filteredUsers,
                handleSelectAll,
                columnFilters,
                setColumnFilters,
                handleSelectUser,
                updateBalance,
                mutation,
                handleEdit,
                openTimeline,
                openNotes,
                toggleUserStatusMutation,
                unfreezeUserMutation,
                openFreeze,
              }}
            />
            <AdminViewAsTab
              {...{ isLoading, columnFilters, setColumnFilters, users, viewAsMutation }}
            />
            <AdminTradeSettingsTab
              {...{
                riskParams,
                handleRiskParamChange,
                globalSettingsMutation,
                isCapitalSettingsChanged,
                isCapitalSettingsSaving,
                handleSaveCapitalSettings,
                isMarketHoursChanged,
                isMarketHoursSaving,
                handleSaveMarketHoursSettings,
                isDefaultRiskParametersChanged,
                isDefaultRiskSaving,
                handleSaveDefaultRiskSettings,
                isOperationalRiskAndLotSettingsChanged,
                isOperationalRiskAndLotSaving,
                handleSaveOperationalRiskAndLotSettings,
              }}
            />
            <AdminInstrumentsTab
              {...{
                instrumentsSubTab,
                setInstrumentsSubTab,
                setCatalogEnableDialogOpen,
                setNewSymbolDialogOpen,
                isLoadingSymbols,
                symbols,
                handleEditSymbol,
                confirmDeleteSymbol,
              }}
            />
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

      <AdminDashboardDialogs
        {...{
          editingUser,
          editDialogOpen,
          setEditDialogOpen,
          editForm,
          handleChange,
          globalSettingsData,
          setEditForm,
          handleSave,
          symbolDialogOpen,
          setSymbolDialogOpen,
          editingSymbol,
          handleSymbolChange,
          handleSymbolSave,
          symbolUpdateMutation,
          catalogEnableDialogOpen,
          setCatalogEnableDialogOpen,
          newSymbolDialogOpen,
          setNewSymbolDialogOpen,
          newSymbol,
          handleNewSymbolChange,
          handleNewSymbolSave,
          newSymbolMutation,
          deleteConfirmOpen,
          setDeleteConfirmOpen,
          handleDeleteSymbol,
          timelineDialogOpen,
          setTimelineDialogOpen,
          timelineUser,
          userTimeline,
          queueUserTimelineExport,
          freezeDialogOpen,
          setFreezeDialogOpen,
          freezeUser,
          freezeReason,
          setFreezeReason,
          freezeUserMutation,
          notesDialogOpen,
          setNotesDialogOpen,
          notesUser,
          newNote,
          setNewNote,
          addNoteMutation,
          userNotes,
          resolveNoteMutation,
        }}
      />
    </div>
  );
}
