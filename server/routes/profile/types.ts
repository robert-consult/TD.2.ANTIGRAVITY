import type { AppRouteMiddleware } from "../../context/routerContext";

export interface ProfileRouterDeps {
  ensureAuth: AppRouteMiddleware;
  sessionCookieName: string;
}
