import type { Router, Request, Response } from "express";
import { decidePolicy, featureGates } from "@shared/policyDecision";
import { buildAuditContext } from "../../lib/auditContext";
import { buildDecisionContext } from "../../policy/buildDecisionContext";
import { loadPolicyConfig } from "../../policy/getPolicyConfig";
import type { TraderRouterDeps } from "./types";

export function registerPolicySnapshotRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth } = deps;

  router.get("/api/policy/snapshot", ensureAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const policyConfig = await loadPolicyConfig();
      const auditCtx = buildAuditContext(req);
      const decisionCtx = await buildDecisionContext({
        userId,
        nowMs: Date.now(),
        request: {
          correlationId: auditCtx.correlationId,
          actorType: auditCtx.actorType,
          actorUserId: auditCtx.actorUserId,
          sessionId: auditCtx.sessionId,
          ip: auditCtx.ip,
          userAgent: auditCtx.userAgent,
        },
        policyConfig,
      });
      const decisions = {
        tradeOpenOrIncrease: decidePolicy("TRADE_OPEN_OR_INCREASE", decisionCtx, policyConfig),
        tradeCloseOrReduce: decidePolicy("TRADE_CLOSE_OR_REDUCE", decisionCtx, policyConfig),
        tradeCancelPending: decidePolicy("TRADE_CANCEL_PENDING", decisionCtx, policyConfig),
        tradeModifySltp: decidePolicy("TRADE_MODIFY_SLTP", decisionCtx, policyConfig),
        viewKyc: decidePolicy("KYC_VIEW", decisionCtx, policyConfig),
        submitKyc: decidePolicy("KYC_SUBMIT", decisionCtx, policyConfig),
        setPreferredPaymentCurrency: decidePolicy("PREFERRED_PAYMENT_CURRENCY_SET", decisionCtx, policyConfig),
        requestPayout: decidePolicy("PAYOUT_REQUEST", decisionCtx, policyConfig),
      };
      const gates = featureGates(decisionCtx, policyConfig);

      res.json({
        accountState: gates.accountState,
        contenderEligible: gates.contenderEligible,
        metrics: decisionCtx.metrics,
        user: {
          userTier: decisionCtx.user.userTier,
          contenderTier: decisionCtx.user.contenderTier,
        },
        kyc: decisionCtx.kyc,
        decisions,
      });
    } catch (error) {
      console.error("Policy snapshot error:", error);
      res.status(500).json({ message: "Failed to load policy snapshot" });
    }
  });
}
