import type { Request, Response, Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@db";
import { systemConfig } from "@shared/schema";
import { sha256 } from "../../legal/cryptoUtils";
import { getSignupPublicConfig } from "../../services/signupPublicConfig";

export function registerSignupConfigRoutes(router: Router) {
  // Public signup configuration (captcha + phone enforcement)
  router.get("/auth/signup-config", async (_req: Request, res: Response) => {
    res.json(await getSignupPublicConfig());
  });

  // Public waitlist policy (communications privacy notice)
  router.get("/auth/waitlist-policy", async (_req: Request, res: Response) => {
    const [row] = await db
      .select({
        signupWaitlistPolicyVersion: systemConfig.signupWaitlistPolicyVersion,
        signupWaitlistPolicyContent: systemConfig.signupWaitlistPolicyContent,
      })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);
    const version = String((row as any)?.signupWaitlistPolicyVersion ?? "1");
    const content = String((row as any)?.signupWaitlistPolicyContent ?? "");
    return res.json({ ok: true, version, sha256: sha256(content), content });
  });
}
