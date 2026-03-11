import { CSRF_HEADER_NAME, CSRF_TOKEN_ENDPOINT } from "@shared/security/csrf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addListenerMock = vi.hoisted(() => vi.fn());
const removeListenerMock = vi.hoisted(() => vi.fn());
const isNativeAppMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: addListenerMock,
  },
}));

vi.mock("./mobile-utils", () => ({
  isNativeApp: isNativeAppMock,
}));

describe("mobile session manager", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());

    addListenerMock.mockReset();
    removeListenerMock.mockReset();
    isNativeAppMock.mockReset();

    isNativeAppMock.mockReturnValue(true);
    addListenerMock.mockResolvedValue({ remove: removeListenerMock });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deduplicates concurrent current-user checks", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 7,
        email: "trader@tradehub.example.com",
        isAdmin: false,
      }),
    } as Response);

    const { checkSessionStatus } = await import("./session-manager");

    const [first, second] = await Promise.all([
      checkSessionStatus(),
      checkSessionStatus(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      isAuthenticated: true,
      userId: 7,
      email: "trader@tradehub.example.com",
      isAdmin: false,
    });
  });

  it("performs csrf-protected logout when a token is available", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: "csrf-token-123" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
      } as Response);

    const { secureLogout } = await import("./session-manager");

    await expect(secureLogout()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      CSRF_TOKEN_ENDPOINT,
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { [CSRF_HEADER_NAME]: "csrf-token-123" },
      }),
    );
  });

  it("monitors resume and periodic expiry checks for native wrapper sessions", async () => {
    const fetchMock = vi.mocked(fetch);
    let appStateCallback: ((state: { isActive: boolean }) => Promise<void>) | undefined;

    addListenerMock.mockImplementation(async (_eventName, callback) => {
      appStateCallback = callback;
      return { remove: removeListenerMock };
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 9,
          email: "active@tradehub.example.com",
          isAdmin: false,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      } as Response);

    const { initSessionMonitoring } = await import("./session-manager");

    const onSessionValid = vi.fn();
    const onSessionExpired = vi.fn();
    const cleanup = initSessionMonitoring({
      onSessionValid,
      onSessionExpired,
    });

    await appStateCallback?.({ isActive: true });
    expect(onSessionValid).toHaveBeenCalledWith(
      expect.objectContaining({
        isAuthenticated: true,
        userId: 9,
      }),
    );

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);

    cleanup();
    await Promise.resolve();
    expect(removeListenerMock).toHaveBeenCalledTimes(1);
  });
});
