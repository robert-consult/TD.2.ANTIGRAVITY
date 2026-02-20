// @ts-nocheck
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
      const decisionCtx = await buildDecisionContext(userId, buildAuditContext(req), {
        expectedPathCode: "POLICY_VIEW",
      });

      const decisions: Record<string, any> = {};
      for (const pathCode of Object.keys(featureGates)) {
        decisions[pathCode] = decidePolicy({
          pathCode,
          score: decisionCtx.score,
          accountAgeDays: decisionCtx.accountAgeDays,
          completedChallengePhaseCount: decisionCtx.completedChallengePhaseCount,
          profitableDays: decisionCtx.profitableDays,
          maxConsecutiveLosses: decisionCtx.maxConsecutiveLosses,
          policyConfig,
          challengeStatus: decisionCtx.challengeStatus,
        });
      }

      res.json({
        score: decisionCtx.score,
        accountAgeDays: decisionCtx.accountAgeDays,
        completedChallengePhaseCount: decisionCtx.completedChallengePhaseCount,
        profitableDays: decisionCtx.profitableDays,
        maxConsecutiveLosses: decisionCtx.maxConsecutiveLosses,
        challengeStatus: decisionCtx.challengeStatus,
        decisions,
      });
    } catch (error) {
      console.error("Policy snapshot error:", error);
      res.status(500).json({ message: "Failed to load policy snapshot" });
    }
  });
}
