import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { educationModules } from "./content/educationModules";

/**
 * Website-only routes — NO auth, NO trading, NO database.
 *
 * Only three endpoints:
 *  1. GET  /api/status           — health check
 *  2. GET  /api/education/modules — returns website-owned education content
 *  3. POST /api/contact          — validates and forwards contact form submissions
 */
const contactSubmissionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  experienceLevel: z.enum(["Beginner", "Intermediate", "Pro"]),
  hasAppAccount: z.boolean().default(false),
  message: z.string().trim().min(20).max(4000),
});

const CONTACT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const CONTACT_RATE_LIMIT_MAX = 5;
const contactRateLimits = new Map<string, { count: number; resetAt: number }>();

function getRateLimitKey(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() || "anonymous";
  }
  return req.ip || "anonymous";
}

function consumeContactRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const current = contactRateLimits.get(key);

  if (!current || current.resetAt <= now) {
    contactRateLimits.set(key, {
      count: 1,
      resetAt: now + CONTACT_RATE_LIMIT_WINDOW_MS,
    });
    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(CONTACT_RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  current.count += 1;
  contactRateLimits.set(key, current);

  return {
    allowed: current.count <= CONTACT_RATE_LIMIT_MAX,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

async function forwardContactSubmission(submission: z.infer<typeof contactSubmissionSchema>) {
  const webhookUrl = process.env.WEBSITE_CONTACT_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    throw new Error("CONTACT_WEBHOOK_NOT_CONFIGURED");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "tradequip-website/1.0",
    },
    body: JSON.stringify({
      source: "tradequip-website",
      submittedAt: new Date().toISOString(),
      submission,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`CONTACT_WEBHOOK_${response.status}`);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check
  app.get("/api/status", (_req, res) => {
    res.json({ status: "ok", service: "tradequip-website" });
  });

  app.get("/api/education/modules", (_req, res) => {
    return res.json(educationModules);
  });

  app.post("/api/contact", async (req, res) => {
    const rateLimit = consumeContactRateLimit(getRateLimitKey(req));
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return res.status(429).json({ message: "Too many submissions. Please try again later." });
    }

    const parsed = contactSubmissionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid contact submission." });
    }

    try {
      await forwardContactSubmission(parsed.data);
      return res.status(202).json({ message: "Received" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "UNKNOWN_CONTACT_DELIVERY_FAILURE";

      if (reason !== "CONTACT_WEBHOOK_NOT_CONFIGURED") {
        console.error("Website contact delivery failed", { reason });
      }

      const statusCode = reason === "CONTACT_WEBHOOK_NOT_CONFIGURED" ? 503 : 502;
      const message =
        reason === "CONTACT_WEBHOOK_NOT_CONFIGURED"
          ? "Contact intake is temporarily unavailable."
          : "Unable to deliver your message right now.";

      return res.status(statusCode).json({ message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
