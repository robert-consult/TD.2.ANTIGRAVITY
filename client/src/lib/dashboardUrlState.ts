import { PRODUCTION_APP_BASE_URL } from "@shared/appSurfaceConfig";

export const DASHBOARD_ROUTE_CHANGED_EVENT = "tq:dashboard-route-changed";

const DASHBOARD_TABS = ["quotes", "chart", "trade", "history", "leaderboard", "account"] as const;
const ACCOUNT_PANELS = ["account", "mailbox"] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number];
export type DashboardAccountPanel = (typeof ACCOUNT_PANELS)[number];

export type DashboardRouteState = {
  tab: DashboardTab;
  symbol?: string;
  panel?: DashboardAccountPanel;
};

type UrlLike = Pick<Location, "pathname" | "search"> | URL;

function sanitizeTab(value: unknown): DashboardTab {
  const raw = String(value ?? "").trim().toLowerCase();
  return DASHBOARD_TABS.includes(raw as DashboardTab) ? (raw as DashboardTab) : "quotes";
}

function sanitizePanel(value: unknown): DashboardAccountPanel | undefined {
  const raw = String(value ?? "").trim().toLowerCase();
  return ACCOUNT_PANELS.includes(raw as DashboardAccountPanel)
    ? (raw as DashboardAccountPanel)
    : undefined;
}

function sanitizeSymbol(value: unknown): string | undefined {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return undefined;
  return /^[A-Z0-9._-]{3,16}$/.test(raw) ? raw : undefined;
}

function getUrl(source?: UrlLike): URL {
  if (source instanceof URL) return source;
  if (source) {
    return new URL(`${source.pathname || "/"}${source.search || ""}`, `${PRODUCTION_APP_BASE_URL}/`);
  }
  if (typeof window !== "undefined") {
    return new URL(window.location.href);
  }
  return new URL("/", `${PRODUCTION_APP_BASE_URL}/`);
}

export function normalizeDashboardRouteState(
  state: Partial<DashboardRouteState> | null | undefined,
): DashboardRouteState {
  const tab = sanitizeTab(state?.tab);
  const symbol = sanitizeSymbol(state?.symbol);
  const panel = sanitizePanel(state?.panel);

  return {
    tab,
    ...((tab === "chart" || tab === "trade") && symbol ? { symbol } : {}),
    ...(tab === "account" && panel === "mailbox" ? { panel } : {}),
  };
}

export function readDashboardRouteState(source?: UrlLike): DashboardRouteState {
  const url = getUrl(source);
  return normalizeDashboardRouteState({
    tab: sanitizeTab(url.searchParams.get("tab")),
    symbol: sanitizeSymbol(url.searchParams.get("symbol")),
    panel: sanitizePanel(url.searchParams.get("panel")),
  });
}

export function buildDashboardUrl(state: Partial<DashboardRouteState> | null | undefined): string {
  const normalized = normalizeDashboardRouteState(state);
  const params = new URLSearchParams();
  if (normalized.tab !== "quotes") {
    params.set("tab", normalized.tab);
  }
  if ((normalized.tab === "chart" || normalized.tab === "trade") && normalized.symbol) {
    params.set("symbol", normalized.symbol);
  }
  if (normalized.tab === "account" && normalized.panel === "mailbox") {
    params.set("panel", normalized.panel);
  }
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

export function areDashboardRouteStatesEqual(
  left: Partial<DashboardRouteState> | null | undefined,
  right: Partial<DashboardRouteState> | null | undefined,
): boolean {
  const normalizedLeft = normalizeDashboardRouteState(left);
  const normalizedRight = normalizeDashboardRouteState(right);
  return (
    normalizedLeft.tab === normalizedRight.tab &&
    normalizedLeft.symbol === normalizedRight.symbol &&
    normalizedLeft.panel === normalizedRight.panel
  );
}

export function dispatchDashboardRouteStateChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DASHBOARD_ROUTE_CHANGED_EVENT));
}

export function writeDashboardRouteState(
  state: Partial<DashboardRouteState> | null | undefined,
  options?: { replace?: boolean },
): void {
  if (typeof window === "undefined") return;
  const nextUrl = buildDashboardUrl(state);
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl === currentUrl) {
    dispatchDashboardRouteStateChange();
    return;
  }

  const method = options?.replace ? "replaceState" : "pushState";
  window.history[method]({}, "", nextUrl);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function subscribeDashboardRouteState(
  listener: (state: DashboardRouteState) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const notify = () => listener(readDashboardRouteState());
  const handleEvent = () => notify();

  window.addEventListener("popstate", handleEvent);
  window.addEventListener(DASHBOARD_ROUTE_CHANGED_EVENT, handleEvent);

  return () => {
    window.removeEventListener("popstate", handleEvent);
    window.removeEventListener(DASHBOARD_ROUTE_CHANGED_EVENT, handleEvent);
  };
}
