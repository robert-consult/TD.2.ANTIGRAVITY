import { useEffect, useRef } from "react";
import { normalizeAppPathCandidate as resolveWrapperAppPathCandidate } from "@shared/appLinks";
import { useAuth } from "@/hooks/use-auth";
import { navigateToAppPath } from "@/lib/appNavigation";
import type { DashboardTab } from "@/lib/dashboardUrlState";
import {
  appLifecycle,
  initDeepLinking,
  initPushNotificationListeners,
  initSessionMonitoring,
  initializeMobile,
  isNativeApp,
  network,
  parseDeepLink,
  registerPushNotifications,
  sendTokenToServer,
} from "../../../MOBILE/src/mobile/utils";
import type {
  DeepLinkResult,
  PushNotificationData,
} from "../../../MOBILE/src/mobile/utils";

function resolveNotificationTarget(notification: PushNotificationData): string | null {
  const data = notification.data ?? {};
  const directCandidates = [
    data.appPath,
    data.path,
    data.route,
    data.url,
    data.deepLink,
    data.deeplink,
  ];

  for (const candidate of directCandidates) {
    const normalized = resolveWrapperAppPathCandidate(String(candidate ?? ""));
    if (normalized) {
      return normalized;
    }
  }

  const route = String(data.screen ?? data.tab ?? data.target ?? "").trim().toLowerCase();
  const symbol = String(data.symbol ?? "").trim().toUpperCase();
  const hasValidSymbol = /^[A-Z0-9._-]{3,16}$/.test(symbol);

  const dashboardTabMap: Record<string, DashboardTab> = {
    quotes: "quotes",
    chart: "chart",
    trade: "trade",
    history: "history",
    leaderboard: "leaderboard",
    account: "account",
    mailbox: "account",
  };

  if (route === "profile" || route === "settings") return "/profile";
  if (route === "journal") return "/journal";
  if (route === "verify-email" && data.token) {
    return `/verify-email?token=${encodeURIComponent(String(data.token))}`;
  }

  const dashboardTab = dashboardTabMap[route];
  if (dashboardTab === "account" && route === "mailbox") {
    return "/?tab=account&panel=mailbox";
  }
  if (dashboardTab === "chart" || dashboardTab === "trade") {
    return hasValidSymbol
      ? `/?tab=${dashboardTab}&symbol=${encodeURIComponent(symbol)}`
      : `/?tab=${dashboardTab}`;
  }
  if (dashboardTab) {
    return dashboardTab === "quotes" ? "/" : `/?tab=${dashboardTab}`;
  }

  return null;
}

export function MobileWrapperBridge() {
  const { checkAuth, isAuthenticated, user } = useAuth();
  const lastPushUserIdRef = useRef<number | null>(null);
  const authSyncRef = useRef<{
    inFlight: Promise<void> | null;
    lastStartedAtMs: number;
  }>({
    inFlight: null,
    lastStartedAtMs: 0,
  });
  const nativeApp = isNativeApp();

  useEffect(() => {
    if (!nativeApp) return;
    void initializeMobile().catch((error) => {
      console.error("[mobile] wrapper initialization failed", error);
    });
  }, [nativeApp]);

  useEffect(() => {
    if (!nativeApp) return;

    const handleDeepLink = (result: DeepLinkResult) => {
      if (!result.appPath) return;
      navigateToAppPath(result.appPath);
    };

    return initDeepLinking(handleDeepLink);
  }, [nativeApp]);

  useEffect(() => {
    if (!nativeApp) return;

    const syncAuthState = () => {
      const nowMs = Date.now();
      const existing = authSyncRef.current.inFlight;
      if (existing) {
        return existing;
      }

      if (nowMs - authSyncRef.current.lastStartedAtMs < 2_000) {
        return Promise.resolve();
      }

      const next = checkAuth().catch((error) => {
        console.warn("[mobile] auth refresh failed", error);
      }).finally(() => {
        if (authSyncRef.current.inFlight === next) {
          authSyncRef.current.inFlight = null;
        }
      });

      authSyncRef.current = {
        inFlight: next,
        lastStartedAtMs: nowMs,
      };

      return next;
    };

    const stopSessionMonitoring = initSessionMonitoring({
      onSessionValid: () => {
        void syncAuthState();
      },
      onSessionExpired: () => {
        void syncAuthState();
      },
      onNetworkError: () => undefined,
    });

    const stopNetworkMonitoring = network.onChange((status) => {
      if (status.connected) {
        void syncAuthState();
      }
    });

    const stopBackButton = appLifecycle.onBackButton(() => {
      const atDashboardHome =
        window.location.pathname === "/" &&
        window.location.search.length === 0 &&
        window.location.hash.length === 0;

      if (!atDashboardHome) {
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
        navigateToAppPath("/");
        return;
      }

      void appLifecycle.exitApp();
    });

    return () => {
      stopSessionMonitoring();
      stopNetworkMonitoring();
      stopBackButton();
    };
  }, [checkAuth, nativeApp]);

  useEffect(() => {
    if (!nativeApp) return;
    return initPushNotificationListeners({
      onNotificationTapped: (notification) => {
        const target = resolveNotificationTarget(notification);
        if (target) {
          navigateToAppPath(target);
        }
      },
    });
  }, [nativeApp]);

  useEffect(() => {
    if (!nativeApp || !isAuthenticated || !user?.id) {
      lastPushUserIdRef.current = null;
      return;
    }
    if (lastPushUserIdRef.current === user.id) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const token = await registerPushNotifications();
      if (!token || cancelled) return;
      const synced = await sendTokenToServer(token);
      if (!cancelled && synced) {
        lastPushUserIdRef.current = user.id;
      }
    })().catch((error) => {
      console.warn("[mobile] push registration failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, nativeApp, user?.id]);

  return null;
}

export default MobileWrapperBridge;
