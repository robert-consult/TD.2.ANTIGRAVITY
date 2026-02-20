import { Router } from "express";
import type { RouterContext } from "../../context/routerContext";
import type { ProfileRouterDeps } from "./types";
import { registerProfileUpdateRoute } from "./update";
import { registerChangePasswordRoute } from "./changePassword";
import { registerDeactivateRoute } from "./deactivate";
import { registerDeleteAccountRoute } from "./deleteAccount";
import { registerProfileMeRoute } from "./me";
import { registerLoginHistoryRoute } from "./loginHistory";
import { registerSessionsRoutes } from "./sessions";
import { registerPreferencesRoutes } from "./preferences";
import { registerKycRoutes } from "./kyc";
import { registerPayoutRoutes } from "./payout";

export function createProfileRouter(ctx: RouterContext): Router {
  const router = Router();

  const deps: ProfileRouterDeps = {
    ensureAuth: ctx.middleware.ensureAuth,
    sessionCookieName: ctx.sessionCookieName,
  };

  registerProfileUpdateRoute(router, deps);
  registerChangePasswordRoute(router, deps);
  registerDeactivateRoute(router, deps);
  registerDeleteAccountRoute(router, deps);
  registerProfileMeRoute(router, deps);
  registerLoginHistoryRoute(router, deps);
  registerSessionsRoutes(router, deps);
  registerPreferencesRoutes(router, deps);
  registerKycRoutes(router, deps);
  registerPayoutRoutes(router, deps);

  return router;
}
