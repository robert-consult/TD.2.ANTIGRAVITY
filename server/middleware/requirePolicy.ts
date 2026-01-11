import { Request, Response, NextFunction } from "express";
import { buildDecisionContext } from "../policy/buildDecisionContext";
import { decidePolicy, type PolicyAction, type PolicyDecision } from "../../shared/policyDecision";
import { appendIdentityAudit } from "../services/identityAudit";
import { buildAuditContext } from "../lib/auditContext";
import { loadPolicyConfig } from "../policy/getPolicyConfig";

export interface PolicyEnforcedRequest extends Request {
  policyDecision?: PolicyDecision;
  policyAction?: PolicyAction;
}

export type PolicyActionResolver = PolicyAction | ((req: PolicyEnforcedRequest) => PolicyAction);

export function requirePolicy(action: PolicyActionResolver) {
  return async (req: PolicyEnforcedRequest, res: Response, next: NextFunction) => {
    const userId = (req.session as any)?.userId;
    
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const auditCtx = buildAuditContext(req);
      const policyConfig = await loadPolicyConfig();
      const resolvedAction = typeof action === "function" ? action(req) : action;

      const ctx = await buildDecisionContext({
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

      const decision = decidePolicy(resolvedAction, ctx, policyConfig);
      req.policyDecision = decision;
      req.policyAction = resolvedAction;
      res.setHeader("x-correlation-id", auditCtx.correlationId);

      if (!decision.allowed) {
        try {
          appendIdentityAudit({
            userId,
            email: ctx.user.email,
            username: ctx.user.username ?? undefined,
            category: "POLICY",
            type: "ACCOUNT_ACTION_DENIED",
            title: `Policy denied: ${resolvedAction}`,
            description: `Deny code: ${decision.deny?.code ?? decision.deny_code}`,
            ip: auditCtx.ip,
            userAgent: auditCtx.userAgent ?? undefined,
            actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
            actorType: auditCtx.actorType,
            actorUserId: auditCtx.actorUserId,
            sessionId: auditCtx.sessionId,
            correlationId: auditCtx.correlationId,
            data: {
              action: resolvedAction,
              deny: decision.deny ?? null,
              accountState: decision.accountState ?? decision.derived?.accountState ?? null,
              derived: decision.derived ?? null,
            },
          });
        } catch (auditErr) {
          console.error("Error writing policy deny audit:", auditErr);
        }

        const httpStatus = decision.deny?.httpStatus ?? getHttpStatusForDenyCode(decision.deny_code);
        return res.status(httpStatus).json({
          message: decision.deny?.messageKey ? decision.deny.messageKey : getMessageForDenyCode(decision.deny_code),
          deny_code: decision.deny?.code ?? decision.deny_code,
          deny: decision.deny ?? null,
          derived: decision.derived ?? null,
          accountState: decision.accountState ?? decision.derived?.accountState,
          showLockedBanner: decision.showLockedBanner,
          redirectTo: decision.redirectTo,
          correlationId: auditCtx.correlationId,
        });
      }

      next();
    } catch (error) {
      console.error("Policy enforcement error:", error);
      return res.status(500).json({ message: "Policy check failed" });
    }
  };
}

function getHttpStatusForDenyCode(code?: string): number {
  switch (code) {
    case "ACCOUNT_SUSPENDED":
    case "ADMIN_SUSPENDED":
    case "EMAIL_UNVERIFIED_GRACE_EXPIRED":
    case "EMAIL_NOT_VERIFIED":
    case "EMAIL_REVERIFY_OVERDUE":
      return 403;
    case "EMAIL_SEND_RATE_LIMIT":
    case "EMAIL_SEND_COOLDOWN":
    case "SMS_RATE_LIMIT":
    case "SMS_OTP_TOO_MANY_ATTEMPTS":
      return 429;
    case "SMS_NOT_ELIGIBLE":
    case "SMS_NOT_ELIGIBLE_TIER":
    case "KYC_NOT_SELECTED":
    case "KYC_STATE_INVALID":
    case "ACTION_NOT_ALLOWED_IN_STATE":
      return 403;
    default:
      return 403;
  }
}

function getMessageForDenyCode(code?: string): string {
  switch (code) {
    case "ACCOUNT_SUSPENDED":
    case "ADMIN_SUSPENDED":
      return "Your account has been suspended. Please contact support.";
    case "EMAIL_UNVERIFIED_GRACE_EXPIRED":
    case "EMAIL_NOT_VERIFIED":
      return "Please verify your email address to continue trading.";
    case "EMAIL_REVERIFY_OVERDUE":
      return "Your email verification has expired. Please re-verify your email.";
    case "EMAIL_SEND_RATE_LIMIT":
      return "Daily email limit reached. Please try again tomorrow.";
    case "EMAIL_SEND_COOLDOWN":
      return "Please wait before requesting another verification email.";
    case "SMS_NOT_ELIGIBLE":
    case "SMS_NOT_ELIGIBLE_TIER":
    case "SMS_NOT_ELIGIBLE_CONTENDER":
      return "Phone verification requires account progression. Keep trading to unlock (30+ days, 120% return, 30+ trades OR 90+ days, 10% return in last 90d, 20+ trades in last 90d).";
    case "SMS_RATE_LIMIT":
      return "SMS limit reached. Please try again later.";
    case "SMS_OTP_TOO_MANY_ATTEMPTS":
      return "Too many failed attempts. Please wait before trying again.";
    case "KYC_NOT_SELECTED":
      return "KYC verification is only available for selected traders.";
    case "KYC_STATE_INVALID":
      return "KYC submission is not allowed in the current state.";
    case "ACTION_NOT_ALLOWED_IN_STATE":
      return "This action is not allowed in your current account state.";
    default:
      return "Action not permitted.";
  }
}
