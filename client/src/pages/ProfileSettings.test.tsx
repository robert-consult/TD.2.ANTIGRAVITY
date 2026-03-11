import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileSettings from "./ProfileSettings";

const {
  toastSpy,
  fetchWithIdentityMock,
  updateUserSpy,
  logoutSpy,
  setLocaleSpy,
  useQueryMock,
  queryClientMock,
} = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  fetchWithIdentityMock: vi.fn(),
  updateUserSpy: vi.fn(),
  logoutSpy: vi.fn(),
  setLocaleSpy: vi.fn(),
  useQueryMock: vi.fn(),
  queryClientMock: {
    invalidateQueries: vi.fn(),
    fetchQuery: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

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
          return undefined;
        }
      },
    }),
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: 7,
      email: "demo@tradingfx.com",
      username: "demo",
      name: "Demo Trader",
      phone: "",
      countryIso2: "US",
      userTier: "CANDIDATE",
    },
    checkAuth: vi.fn(),
    updateUser: updateUserSpy,
    logout: logoutSpy,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastSpy,
  }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: setLocaleSpy,
    supportedLocales: ["en", "fr"],
  }),
}));

vi.mock("@/lib/fetchWithIdentity", () => ({
  fetchWithIdentity: (...args: unknown[]) => fetchWithIdentityMock(...args),
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: queryClientMock,
}));

vi.mock("wouter", () => ({
  Link: (props: { href: string; children: ReactNode }) => <a href={props.href}>{props.children}</a>,
}));

vi.mock("@/components/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("@/components/TierBadge", () => ({
  TierBadge: () => <div data-testid="tier-badge" />,
  TierProgressCard: () => <div data-testid="tier-progress-card" />,
}));

vi.mock("@/components/VerificationCards", () => ({
  VerificationSection: () => <div data-testid="verification-section" />,
}));

vi.mock("@/components/PhoneNumberInput", () => ({
  PhoneNumberInput: (props: { value?: string; onChange?: (value: string, isValid: boolean) => void }) => (
    <input
      data-testid="phone-number-input"
      value={props.value ?? ""}
      onChange={(event) => props.onChange?.(event.currentTarget.value, true)}
    />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: (props: { children: ReactNode }) => <div>{props.children}</div>,
  SelectContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  SelectItem: (props: { children: ReactNode }) => <div>{props.children}</div>,
  SelectTrigger: (props: { children: ReactNode }) => <div>{props.children}</div>,
  SelectValue: (props: { placeholder?: string }) => <span>{props.placeholder ?? ""}</span>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: (props: { open: boolean; children: ReactNode }) => (props.open ? <div>{props.children}</div> : null),
  DialogContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogDescription: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogFooter: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogHeader: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogTitle: (props: { children: ReactNode }) => <div>{props.children}</div>,
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

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function setQueryState(overrides?: {
  mfaEnabled?: boolean;
  preferences?: {
    timezone?: string;
    language?: string;
    country?: string | null;
    countryLocked?: boolean;
    timezoneEditable?: boolean;
  };
}) {
  useQueryMock.mockImplementation((args: any) => {
    const key = args?.queryKey?.[0];
    if (key === "/api/profile/mfa/status") {
      return {
        data: {
          enabled: Boolean(overrides?.mfaEnabled),
          enabledAt: null,
          hasRecoveryCodes: false,
        },
        refetch: vi.fn(),
      };
    }
    if (key === "/api/meta/timezones") {
      return {
        data: {
          generatedAt: Date.now(),
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
    if (key === "/api/meta/countries") {
      return {
        data: {
          rows: [{ code: "US", name: "United States" }],
        },
      };
    }
    if (key === "/api/meta/languages") {
      return {
        data: {
          rows: [
            { code: "en", name: "English", nativeName: "English" },
            { code: "fr", name: "French", nativeName: "Francais" },
          ],
        },
      };
    }
    if (key === "/api/profile/login-history") {
      return { data: [] };
    }
    if (key === "/api/me/sessions") {
      return {
        data: {
          currentSessionId: "sess-current",
          rows: [
            {
              id: "sess-current",
              createdAt: Date.now(),
              lastSeenAt: Date.now(),
              ip: "127.0.0.1",
              userAgent: "Chrome",
              deviceType: "Desktop",
              browser: "Chrome",
              os: "Linux",
              countryCode: "US",
              region: "TX",
              city: "Dallas",
              inferredTz: "UTC",
              revokedAt: null,
            },
          ],
        },
        refetch: vi.fn(),
      };
    }
    if (key === "/api/auth/devices") {
      return {
        data: [],
        refetch: vi.fn(),
      };
    }
    if (key === "/api/profile/preferences") {
      return {
        data: {
          timezone: "UTC",
          language: "en",
          country: "US",
          countryLocked: true,
          timezoneEditable: true,
          ...overrides?.preferences,
        },
      };
    }
    if (key === "i18nBundle") {
      return { data: { locale: "en", strings: {} } };
    }
    throw new Error(`Unhandled query key: ${String(key)}`);
  });
}

function renderProfileSettings() {
  return render(<ProfileSettings />);
}

describe("ProfileSettings", () => {
  beforeEach(() => {
    toastSpy.mockReset();
    fetchWithIdentityMock.mockReset();
    updateUserSpy.mockReset();
    logoutSpy.mockReset();
    setLocaleSpy.mockReset();
    useQueryMock.mockReset();
    queryClientMock.invalidateQueries.mockReset();
    queryClientMock.fetchQuery.mockReset();
    queryClientMock.getQueryData.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the MFA setup dialog after a successful setup request", async () => {
    setQueryState();
    fetchWithIdentityMock.mockImplementation(async (url: string) => {
      if (url === "/api/profile/mfa/setup") {
        return jsonResponse({
          qrCodeDataUrl: "data:image/png;base64,abc123",
        });
      }
      return jsonResponse({});
    });

    renderProfileSettings();

    fireEvent.click(screen.getByRole("button", { name: "Security & Login" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable 2FA" }));

    await waitFor(() => {
      expect(fetchWithIdentityMock).toHaveBeenCalledWith(
        "/api/profile/mfa/setup",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    expect(screen.getByText("Set Up Two-Factor Authentication")).toBeInTheDocument();
    expect(screen.getByAltText("2FA QR Code")).toHaveAttribute("src", "data:image/png;base64,abc123");
  }, 15_000);

  it("blocks short password submissions before hitting the network", async () => {
    setQueryState();
    fetchWithIdentityMock.mockResolvedValue(jsonResponse({}));

    renderProfileSettings();

    fireEvent.click(screen.getByRole("button", { name: "Security & Login" }));
    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "old-password" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "short" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));

    expect(fetchWithIdentityMock).not.toHaveBeenCalledWith(
      "/api/profile/change-password",
      expect.anything(),
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Error",
        description: "Password must be at least 8 characters",
        variant: "destructive",
      }),
    );
  });

  it("saves preferences without sending a locked country back to the server", async () => {
    setQueryState({
      preferences: {
        timezone: "UTC",
        language: "en",
        country: "US",
        countryLocked: true,
        timezoneEditable: true,
      },
    });
    fetchWithIdentityMock.mockImplementation(async (url: string) => {
      if (url === "/api/profile/preferences") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    });

    renderProfileSettings();

    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));

    await waitFor(() => {
      expect(fetchWithIdentityMock).toHaveBeenCalledWith(
        "/api/profile/preferences",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            language: "en",
            timezone: "UTC",
          }),
        }),
      );
    });

    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/profile/preferences"],
    });
    expect(updateUserSpy).toHaveBeenCalledWith({ language: "en" });
    expect(setLocaleSpy).toHaveBeenCalledWith("en");
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Preferences saved",
      }),
    );
  });
});
