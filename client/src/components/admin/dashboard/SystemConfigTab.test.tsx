import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET_PERFORMANCE_SETTINGS } from "./AdminDashboardSupport";
import { SystemConfigTab } from "./SystemConfigTab";

const {
  toastSpy,
  axiosGetMock,
  axiosPutMock,
  axiosPostMock,
  useQueryMock,
  queryClientMock,
  tabsState,
} = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  axiosGetMock: vi.fn(),
  axiosPutMock: vi.fn(),
  axiosPostMock: vi.fn(),
  useQueryMock: vi.fn(),
  queryClientMock: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
  tabsState: {
    value: "",
    onValueChange: (_value: string) => undefined,
  },
}));

vi.mock("axios", () => {
  const axios = {
    get: (...args: unknown[]) => axiosGetMock(...args),
    put: (...args: unknown[]) => axiosPutMock(...args),
    post: (...args: unknown[]) => axiosPostMock(...args),
  };
  return {
    default: axios,
    ...axios,
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (args: unknown) => useQueryMock(args),
    useMutation: (options: any) => ({
      isPending: false,
      mutate: async (variables?: unknown) => {
        try {
          const result = await options.mutationFn(variables);
          await options.onSuccess?.(result, variables, undefined);
          return result;
        } catch (error) {
          await options.onError?.(error, variables, undefined);
          throw error;
        }
      },
    }),
    useQueryClient: () => queryClientMock,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastSpy,
  }),
}));

vi.mock("@/components/admin/SignupFreezeWaitlistCard", () => ({
  default: () => <div data-testid="signup-freeze-card" />,
}));

vi.mock("@/components/admin/JurisdictionControlsCard", () => ({
  JurisdictionControlsCard: () => <div data-testid="jurisdiction-controls-card" />,
}));

vi.mock("@/components/admin/MarketDataProvidersCard", () => ({
  MarketDataProvidersCard: () => <div data-testid="market-providers-card" />,
}));

vi.mock("@/components/admin/dashboard/MigrationTab", () => ({
  MigrationTab: () => <div data-testid="migration-tab" />,
}));

vi.mock("@/components/admin/dashboard/SystemHealthPanel", () => ({
  SystemHealthPanel: (props: {
    healthProviderKey: string;
    onProbeProvider: () => void;
  }) => (
    <div>
      <div data-testid="health-provider-key">{props.healthProviderKey}</div>
      <button onClick={props.onProbeProvider}>Fetch Status</button>
    </div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: (props: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => {
    tabsState.value = props.value;
    tabsState.onValueChange = props.onValueChange;
    return <div>{props.children}</div>;
  },
  TabsList: (props: { children: ReactNode }) => <div>{props.children}</div>,
  TabsTrigger: (props: { value: string; children: ReactNode }) => (
    <button type="button" onClick={() => tabsState.onValueChange(props.value)}>
      {props.children}
    </button>
  ),
  TabsContent: (props: { value: string; children: ReactNode }) => {
    if (tabsState.value !== props.value) return null;
    return <div>{props.children}</div>;
  },
}));

vi.mock("@/components/ui/select", () => ({
  Select: (props: { children: ReactNode }) => <div>{props.children}</div>,
  SelectContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  SelectItem: (props: { children: ReactNode }) => <div>{props.children}</div>,
  SelectTrigger: (props: { children: ReactNode }) => <div>{props.children}</div>,
  SelectValue: (props: { placeholder?: string }) => <span>{props.placeholder ?? ""}</span>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogFooter: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogHeader: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogTitle: (props: { children: ReactNode }) => <div>{props.children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AlertDialogAction: (props: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
  AlertDialogCancel: (props: { children: ReactNode }) => <button type="button">{props.children}</button>,
  AlertDialogContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AlertDialogDescription: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AlertDialogFooter: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AlertDialogHeader: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AlertDialogTitle: (props: { children: ReactNode }) => <div>{props.children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: (props: { children: ReactNode }) => <div>{props.children}</div>,
  Tooltip: (props: { children: ReactNode }) => <div>{props.children}</div>,
  TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  TooltipTrigger: (props: { children: ReactNode }) => <div>{props.children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: (props: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input
      type="checkbox"
      checked={props.checked}
      onChange={(event) => props.onCheckedChange(event.currentTarget.checked)}
    />
  ),
}));

function createSystemConfig() {
  return {
    id: 1,
    maintenanceMode: false,
    tradingHalt: false,
    closeOnlyMode: false,
    blockOpenOnStaleQuotes: true,
    maintenanceMessage: "",
    quoteRefreshMs: 1000,
    feedPollMs: 1000,
    staleThresholdMs: 10000,
    fxRolloverTz: "UTC",
    fxRolloverTime: "17:00",
    signupCaptchaEnforce: true,
    captchaProvider: "cloudflare-turnstile",
    signupPhoneEnforce: false,
    legalCoverageEnforce: true,
    jurisdictionRestrictedIso2Csv: "",
    jurisdictionRestrictedMessage: "",
    jurisdictionEnforceByIpGeo: true,
    jurisdictionEnforceBySignupCountry: true,
    jurisdictionBlockSignup: true,
    jurisdictionBlockLogin: true,
    allowUserTimezoneEdit: true,
    scoutTabEnabled: true,
    signupFreeze: false,
    signupFreezeMessage: "",
    signupWaitlistEnabled: false,
    signupWaitlistInviteSender: "",
    signupWaitlistInviteSubject: "",
    signupWaitlistInviteBodyText: "",
    signupWaitlistAutoInviteOnUnfreeze: false,
    signupWaitlistInviteBatchCap: 50,
    signupWaitlistPolicyVersion: "v1",
    signupWaitlistPolicyContent: "",
    rememberMeEnabled: true,
    rememberMeMaxAgeDays: 30,
    rememberMeMaxDevicesPerUser: 5,
    rememberMeReauthAfterAbsenceDays: 30,
    rememberMeTokenRotationEnabled: true,
    rememberMeTheftAutoRevokeAll: true,
    sessionCookieMaxAgeHours: 24,
    sessionIdleTimeoutMinutes: 0,
    logoutClearAllDeviceTokens: true,
    migrationChunkingEnabled: true,
    migrationChunkSizeMb: 25,
    updatedAt: 42,
    updatedBy: "admin@local.test",
  };
}

function createI18nConfig() {
  return {
    enabled: true,
    defaultLocale: "en",
    supportedLocales: ["en", "fr"],
    autoTranslate: false,
    llmEnabled: false,
    llmProvider: "openai",
    llmModel: "gpt-4o-mini",
    llmMaxBatchSize: 50,
    llmMaxAttempts: 3,
  };
}

function createProvidersData() {
  return {
    activeKey: "demo-feed",
    rows: [
      {
        providerKey: "demo-feed",
        displayName: "Demo Feed",
        isEnabled: true,
        deletedAt: null,
      },
    ],
  };
}

function createHealthData() {
  return {
    activeProviderKey: "demo-feed",
    feedProviderKey: "demo-feed",
    feedProviderConnected: true,
    requestedProvider: {
      configUsable: true,
      missingSecrets: [],
      displayName: "Demo Feed",
    },
    lastProviderSuccessAt: Date.now(),
    lastProviderSuccessKey: "demo-feed",
    failures: 0,
    feedSource: "demo",
    feedSourceAt: Date.now(),
    staleCount: 0,
    cacheSize: 10,
    serverTime: Date.now(),
    lastSuccess: Date.now(),
  };
}

function setQueryState(globalPerformanceData: Record<string, unknown>) {
  const systemConfig = createSystemConfig();
  const i18nConfig = createI18nConfig();
  const providersData = createProvidersData();
  const healthData = createHealthData();
  const refetchHealth = vi.fn();

  useQueryMock.mockImplementation((args: any) => {
    const key = args?.queryKey?.[0];
    if (key === "/api/admin/system-config") {
      return { data: systemConfig, isLoading: false };
    }
    if (key === "/api/admin/global-settings") {
      return { data: globalPerformanceData, isFetchedAfterMount: true };
    }
    if (key === "/api/admin/i18n/config") {
      return { data: i18nConfig, isLoading: false };
    }
    if (key === "/api/admin/market-data/providers") {
      return { data: providersData };
    }
    if (key === "/api/admin/system-health") {
      return { data: healthData, refetch: refetchHealth };
    }
    if (key === "/api/meta/timezones") {
      return {
        data: {
          rows: [
            {
              name: "UTC",
              label: "UTC",
              countryCode: "US",
              countryName: "United States",
              alternativeName: "UTC",
              mainCities: ["New York"],
              rawOffsetInMinutes: 0,
              currentOffsetMinutes: 0,
              abbreviation: "UTC",
              rawFormat: "UTC",
            },
          ],
        },
      };
    }
    throw new Error(`Unhandled query key: ${String(key)}`);
  });
}

function renderSystemConfigTab() {
  return render(<SystemConfigTab />);
}

function getInputNear(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  const section = label.closest("div");
  const input = section?.parentElement?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Input not found for ${labelText}`);
  }
  return input;
}

describe("SystemConfigTab", () => {
  beforeEach(() => {
    toastSpy.mockReset();
    axiosGetMock.mockReset();
    axiosPutMock.mockReset();
    axiosPostMock.mockReset();
    useQueryMock.mockReset();
    queryClientMock.invalidateQueries.mockReset();
    queryClientMock.setQueryData.mockReset();
    tabsState.value = "";
    tabsState.onValueChange = (_value: string) => undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("warns when global performance settings are missing required tier fields", async () => {
    setQueryState({
      updatedAt: 42,
      performanceSettings: {
        restFallbackPollMs: 700,
      },
    });

    renderSystemConfigTab();

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Performance schema is outdated",
          variant: "destructive",
        }),
      );
    });
  });

  it("saves edited market performance settings and invalidates both global-settings caches", async () => {
    setQueryState({
      updatedAt: 42,
      performanceSettings: {
        ...DEFAULT_MARKET_PERFORMANCE_SETTINGS,
      },
    });
    axiosPutMock.mockResolvedValue({
      data: {
        updatedAt: 99,
        performanceSettings: {
          ...DEFAULT_MARKET_PERFORMANCE_SETTINGS,
          restFallbackPollMs: 750,
        },
      },
    });

    renderSystemConfigTab();

    fireEvent.click(screen.getByRole("button", { name: "Market Data" }));

    const pollInput = getInputNear("REST Fallback Poll (ms)");
    fireEvent.change(pollInput, { target: { value: "750" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Performance" }));

    await waitFor(() => {
      expect(axiosPutMock).toHaveBeenCalledWith(
        "/api/admin/global-settings",
        expect.objectContaining({
          restFallbackPollMs: 750,
          expectedUpdatedAt: 42,
        }),
      );
    });

    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/admin/global-settings"],
    });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/global-settings"],
    });

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Performance settings saved",
      }),
    );
  }, 15_000);

  it("probes the selected provider from the health panel and surfaces the success toast", async () => {
    setQueryState({
      updatedAt: 42,
      performanceSettings: {
        ...DEFAULT_MARKET_PERFORMANCE_SETTINGS,
      },
    });
    axiosPostMock.mockResolvedValue({
      data: {
        ok: true,
        quoteCount: 1,
      },
    });

    renderSystemConfigTab();

    fireEvent.click(screen.getByRole("button", { name: "System Health" }));
    expect(screen.getByTestId("health-provider-key")).toHaveTextContent("demo-feed");

    fireEvent.click(screen.getByRole("button", { name: "Fetch Status" }));

    await waitFor(() => {
      expect(axiosPostMock).toHaveBeenCalledWith(
        "/api/admin/market-data/providers/demo-feed/test",
        { symbols: ["EURUSD"] },
      );
    });

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Provider probe OK",
        description: "Quotes: 1",
      }),
    );
  });
});
