import type { NextFunction, Request, Response } from "express";
import { resolvePartnerGateAccess, type PartnerGateKey } from "../partner/onboarding";

export function requirePartnerGate(gate: PartnerGateKey) {
  return async function partnerGateMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = Number((req as any)?.partner?.id || 0);
      if (!Number.isInteger(partnerId) || partnerId <= 0) {
        return res.status(401).json({ message: "PARTNER_AUTH_FAILED" });
      }

      const { state, eval: gateEval } = await resolvePartnerGateAccess(partnerId, gate);
      if (!state || !gateEval) {
        return res.status(401).json({ message: "PARTNER_AUTH_FAILED" });
      }

      if (!gateEval.allowed) {
        const reason = String(gateEval.reason || "PARTNER_GATE_BLOCKED");
        const statusCode =
          reason === "PARTNER_REVOKED" || reason === "PARTNER_INVITE_EXPIRED"
            ? 403
            : 403;
        return res.status(statusCode).json({
          message: reason,
          gate,
          requiredLevel: gateEval.requiredLevel,
          currentLevel: gateEval.currentLevel,
          onboardingStep: state.onboardingStep,
          inviteStatus: state.inviteStatus,
        });
      }

      (req as any).partnerGate = {
        gate,
        requiredLevel: gateEval.requiredLevel,
        currentLevel: gateEval.currentLevel,
        onboardingStep: state.onboardingStep,
        inviteStatus: state.inviteStatus,
      };

      return next();
    } catch (error) {
      console.error("[partner-gate] middleware failure:", error);
      return res.status(500).json({ message: "PARTNER_GATE_INTERNAL_ERROR" });
    }
  };
}
