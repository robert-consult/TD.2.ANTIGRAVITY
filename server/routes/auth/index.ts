import { Router } from "express";
import type { RouterContext } from "../../context/routerContext";
import type { AuthRouterDeps } from "./types";
import { registerLoginRoute } from "./login";
import { registerRegisterRoute } from "./register";
import { registerLogoutRoute } from "./logout";
import { registerCurrentUserRoute } from "./currentUser";
import { registerDevicesRoutes } from "./devices";

export function createAuthRouter(ctx: RouterContext): Router {
  const router = Router();

  const deps: AuthRouterDeps = {
    ensureAuth: ctx.middleware.ensureAuth,
    sessionCookieName: ctx.sessionCookieName,
  };

  registerLoginRoute(router, deps);
  registerRegisterRoute(router, deps);
  registerLogoutRoute(router, deps);
  registerCurrentUserRoute(router, deps);
  registerDevicesRoutes(router, deps);

  return router;
}
