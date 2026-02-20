import type { AppRouteMiddleware, WsBroadcast } from "../../context/routerContext";

export interface TraderRouterDeps {
  ensureAuth: AppRouteMiddleware;
  ensureDoc1TermsAccepted: AppRouteMiddleware;
  broadcast: WsBroadcast;
}
