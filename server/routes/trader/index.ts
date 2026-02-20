import { Router } from "express";
import type { RouterContext } from "../../context/routerContext";
import type { TraderRouterDeps } from "./types";
import { registerTradeOpenRoute } from "./tradeOpen";
import { registerTradesRoutes } from "./trades";
import { registerTradeCloseRoute } from "./tradeClose";
import { registerTradeTargetsRoute } from "./tradeTargets";
import { registerTradeCancelRoute } from "./tradeCancel";
import { registerLeaderboardRoute } from "./leaderboard";
import { registerJournalRoutes } from "./journal";
import { registerPolicySnapshotRoute } from "./policy";
import { registerAccountSummaryRoute } from "./account";

export function createTraderRouter(ctx: RouterContext): Router {
  const router = Router();

  const deps: TraderRouterDeps = {
    ensureAuth: ctx.middleware.ensureAuth,
    ensureDoc1TermsAccepted: ctx.middleware.ensureDoc1TermsAccepted,
    broadcast: ctx.wsBroadcast || (() => {}),
  };

  registerTradeOpenRoute(router, deps);
  registerTradesRoutes(router, deps);
  registerTradeCloseRoute(router, deps);
  registerTradeTargetsRoute(router, deps);
  registerTradeCancelRoute(router, deps);
  registerLeaderboardRoute(router, deps);
  registerJournalRoutes(router, deps);
  registerPolicySnapshotRoute(router, deps);
  registerAccountSummaryRoute(router, deps);

  return router;
}
