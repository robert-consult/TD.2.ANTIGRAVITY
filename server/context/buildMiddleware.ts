import type { AppMiddleware } from "./routerContext";
import { ensureRequestAuthenticated } from "../middleware/auth";
import {
  computeDoc1ReacceptStatus,
  upsertDoc1ReacceptRequirement,
} from "../legal/legalReacceptanceService";

export function buildMiddleware(): AppMiddleware {
  const ensureAuth: AppMiddleware["ensureAuth"] = async (req, res, next) => {
    const ok = await ensureRequestAuthenticated(req, res, {
      unauthorizedMessage: "Not authenticated",
      revokedMessage: "Session has been terminated",
      destroySessionOnRevoked: true,
    });
    if (!ok) return;
    next();
  };

  const ensureDoc1TermsAccepted: AppMiddleware["ensureDoc1TermsAccepted"] = async (
    req,
    res,
    next,
  ) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    try {
      const status = await computeDoc1ReacceptStatus(userId);

      if (status.blocked) {
        await upsertDoc1ReacceptRequirement({ userId, detectedBy: "TRADE", status });
        (req.session as any).legalReacceptRequired = true;

        const code = status.blockedReason || "LEGAL_COVERAGE_BLOCKED";
        const httpStatus = code === "JURISDICTION_RESTRICTED" ? 403 : 409;

        return res.status(httpStatus).json({ message: code, code, blockedReason: status.blockedReason });
      }

      if (status.required) {
        await upsertDoc1ReacceptRequirement({ userId, detectedBy: "TRADE", status });
        (req.session as any).legalReacceptRequired = true;
        return res.status(409).json({
          message: "LEGAL_REACCEPT_REQUIRED",
          code: "LEGAL_REACCEPT_REQUIRED",
          docSet: "DOC1",
          countryIso2: status.countryIso2,
          regionKey: status.regionKey,
          requiredCombinedSha256: status.requiredCombinedSha256,
          lastAcceptedCombinedSha256: status.lastAcceptedCombinedSha256,
        });
      }

      await upsertDoc1ReacceptRequirement({ userId, detectedBy: "TRADE", status });
      (req.session as any).legalReacceptRequired = false;
      return next();
    } catch (e: any) {
      console.error("[Legal] Re-acceptance gate failed:", e);
      return res.status(500).json({ message: "LEGAL_REACCEPT_CHECK_FAILED" });
    }
  };

  return {
    ensureAuth,
    ensureDoc1TermsAccepted,
  };
}
