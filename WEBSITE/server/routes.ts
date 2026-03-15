import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import {
  getEducationCatalog,
  getEducationLesson,
  getEducationModule,
  getLegacyEducationModuleCards,
  getPlatformGuideLesson,
  getPlatformGuideOverview,
} from "./content/contentStore";

/**
 * Website-only routes — NO auth, NO trading, NO database.
 *
 * Primary website endpoints:
 *  1. GET  /api/status
 *  2. GET  /api/education/catalog
 *  3. GET  /api/education/modules/:moduleSlug
 *  4. GET  /api/education/lessons/:moduleSlug/:lessonSlug
 *  5. GET  /api/platform-guide
 *  6. GET  /api/platform-guide/lessons/:lessonSlug
 *  7. POST /api/contact
 *
 * Legacy compatibility:
 *  - GET /api/education/modules
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
    return res.json(getLegacyEducationModuleCards());
  });

  app.get("/api/education/catalog", (_req, res) => {
    return res.json(getEducationCatalog());
  });

  app.get("/api/education/modules/:moduleSlug", (req, res) => {
    const modulePayload = getEducationModule(req.params.moduleSlug);
    if (!modulePayload) {
      return res.status(404).json({ message: "Education module not found." });
    }

    return res.json(modulePayload);
  });

  app.get("/api/education/lessons/:moduleSlug/:lessonSlug", (req, res) => {
    const lessonPayload = getEducationLesson(
      req.params.moduleSlug,
      req.params.lessonSlug,
    );
    if (!lessonPayload) {
      return res.status(404).json({ message: "Education lesson not found." });
    }

    return res.json(lessonPayload);
  });

  app.get("/api/platform-guide", (_req, res) => {
    const platformGuide = getPlatformGuideOverview();
    if (!platformGuide) {
      return res.status(404).json({ message: "Platform guide not found." });
    }

    return res.json(platformGuide);
  });

  app.get("/api/platform-guide/lessons/:lessonSlug", (req, res) => {
    const lessonPayload = getPlatformGuideLesson(req.params.lessonSlug);
    if (!lessonPayload) {
      return res.status(404).json({ message: "Platform guide lesson not found." });
    }

    return res.json(lessonPayload);
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
