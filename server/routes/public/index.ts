import { Router } from "express";
import { registerStatusRoute } from "./status";
import { registerGlobalSettingsRoute } from "./globalSettings";
import { registerSignupConfigRoutes } from "./signupConfig";
import { registerWaitlistRoute } from "./waitlist";
import { registerQuoteRoutes } from "./quotes";
import { registerDiagnosticsRoute } from "./diagnostics";
import { registerSymbolsRoute } from "./symbols";

export function createPublicRouter(): Router {
  const router = Router();
  registerStatusRoute(router);
  registerGlobalSettingsRoute(router);
  registerSignupConfigRoutes(router);
  registerWaitlistRoute(router);
  registerQuoteRoutes(router);
  registerDiagnosticsRoute(router);
  registerSymbolsRoute(router);
  return router;
}
