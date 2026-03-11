import { beforeEach, describe, expect, it, vi } from "vitest";

const addListenerMock = vi.hoisted(() => vi.fn());
const getLaunchUrlMock = vi.hoisted(() => vi.fn());
const removeListenerMock = vi.hoisted(() => vi.fn());
const isNativeAppMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: addListenerMock,
    getLaunchUrl: getLaunchUrlMock,
  },
}));

vi.mock("./mobile-utils", () => ({
  isNativeApp: isNativeAppMock,
}));

import { generateDeepLink, initDeepLinking, parseDeepLink } from "./deep-linking";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("mobile deep linking", () => {
  beforeEach(() => {
    addListenerMock.mockReset();
    getLaunchUrlMock.mockReset();
    removeListenerMock.mockReset();
    isNativeAppMock.mockReset();

    isNativeAppMock.mockReturnValue(true);
    addListenerMock.mockResolvedValue({ remove: removeListenerMock });
    getLaunchUrlMock.mockResolvedValue(null);
  });

  it("parses canonical web and native scheme links onto live dashboard routes", () => {
    expect(parseDeepLink("https://tradehub.example.com/trade/eurusd")).toMatchObject({
      screen: "trade",
      params: { symbol: "EURUSD" },
      appPath: "/?tab=trade&symbol=EURUSD",
    });

    expect(parseDeepLink("tradequip://chart/gbpusd")).toMatchObject({
      screen: "chart",
      params: { symbol: "GBPUSD" },
      appPath: "/?tab=chart&symbol=GBPUSD",
    });

    expect(parseDeepLink("https://evil.example.com/trade/eurusd")).toBeNull();
  });

  it("generates canonical web links for wrapper-routed screens", () => {
    expect(generateDeepLink("mailbox")).toBe(
      "https://tradehub.example.com/?tab=account&panel=mailbox",
    );
    expect(generateDeepLink("profile")).toBe("https://tradehub.example.com/profile");
    expect(generateDeepLink("verify-email", { token: "abc123" })).toBe(
      "https://tradehub.example.com/verify-email?token=abc123",
    );
  });

  it("dispatches launch urls and runtime url-open events to the wrapper navigation callback", async () => {
    const onNavigate = vi.fn();
    let appUrlOpenHandler: ((event: { url: string }) => void) | undefined;

    getLaunchUrlMock.mockResolvedValue({
      url: "https://tradehub.example.com/history",
    });
    addListenerMock.mockImplementation(async (_eventName, callback) => {
      appUrlOpenHandler = callback;
      return { remove: removeListenerMock };
    });

    const cleanup = initDeepLinking(onNavigate);
    await flushMicrotasks();

    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        screen: "history",
        appPath: "/?tab=history",
      }),
    );

    appUrlOpenHandler?.({ url: "tradequip://account/mailbox" });
    expect(onNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screen: "mailbox",
        appPath: "/?tab=account&panel=mailbox",
      }),
    );

    cleanup();
    await flushMicrotasks();
    expect(removeListenerMock).toHaveBeenCalledTimes(1);
  });
});
