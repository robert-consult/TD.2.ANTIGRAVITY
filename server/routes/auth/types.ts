import type { AppRouteMiddleware } from "../../context/routerContext";

export interface AuthRouterDeps {
  ensureAuth: AppRouteMiddleware;
  sessionCookieName: string;
}
