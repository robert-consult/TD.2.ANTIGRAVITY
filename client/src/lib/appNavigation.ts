import {
  dispatchDashboardRouteStateChange,
  readDashboardRouteState,
  writeDashboardRouteState,
} from "./dashboardUrlState";

function resolveRelativeAppUrl(appPath: string): URL {
  return new URL(appPath, typeof window !== "undefined" ? window.location.origin : "https://tradehub.example.com");
}

export function navigateToAppPath(appPath: string, options?: { replace?: boolean }): void {
  if (typeof window === "undefined") return;

  const nextUrl = resolveRelativeAppUrl(appPath);
  if (nextUrl.pathname === "/") {
    writeDashboardRouteState(readDashboardRouteState(nextUrl), options);
    return;
  }

  const nextRelativeUrl = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextRelativeUrl === currentRelativeUrl) {
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (nextUrl.pathname === "/") {
      dispatchDashboardRouteStateChange();
    }
    return;
  }

  const method = options?.replace ? "replaceState" : "pushState";
  window.history[method]({}, "", nextRelativeUrl);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
