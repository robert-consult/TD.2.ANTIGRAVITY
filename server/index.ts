// @ts-nocheck
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
// Import and initialize admin data views
import { main as setupAdminViews } from "../db/create_admin_views";
import { bootstrapDoc1Seed } from "./legal/bootstrapDoc1Seed";
import { startGriftEvaluationScheduler } from "./grift/griftScheduler";
import { startVerificationReminderCron } from "./cron/verificationReminders";
import { startAccountLifecycleSweepScheduler } from "./services/accountLifecycleSweepScheduler";
import { getIp2AsnDatasetPath, maybeImportIp2AsnDataset } from "./grift/griftIp2AsnDataset";
import { startI18nWorker } from "./i18n/worker";
import { maybeIngestBuiltManifest } from "./i18n/service";
import { dbDialect } from "@db/config";
import { dbClient } from "@db";
import { getValkey } from "./services/valkey";
import { withGriftClient } from "./grift/griftDb";

// Validate required environment variables at startup
function validateEnvVars() {
  const warnings: string[] = [];
  const criticalErrors: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";
  
  // CRITICAL: Legal terms HMAC secret (required for tamper-evident token signing)
  const legalSecret = process.env.LEGAL_TERMS_HMAC_SECRET;
  if (!legalSecret || legalSecret.length < 32) {
    criticalErrors.push(
      "LEGAL_TERMS_HMAC_SECRET not configured or too short (min 32 chars) - " +
      "legal compliance tokens cannot be signed. Generate with: openssl rand -hex 32"
    );
  }
  
  // Critical for email verification
  if (!process.env.RESEND_API_KEY) {
    warnings.push("RESEND_API_KEY not configured - email verification will fail");
  }
  
  // Critical for SMS verification  
  if (!process.env.TWILIO_ACCOUNT_SID) {
    warnings.push("TWILIO_ACCOUNT_SID not configured - SMS verification will fail");
  }
  if (!process.env.TWILIO_AUTH_TOKEN) {
    warnings.push("TWILIO_AUTH_TOKEN not configured - SMS verification will fail");
  }
  const hasSmsSender = !!process.env.TWILIO_MESSAGING_SERVICE_SID || !!process.env.TWILIO_FROM_NUMBER;
  if (!hasSmsSender) {
    warnings.push("TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER not configured - SMS verification will fail");
  }
  
  // Log warnings
  warnings.forEach(w => console.warn(`[ENV WARNING] ${w}`));
  criticalErrors.forEach(e => console.error(`[ENV CRITICAL] ${e}`));
  
  // Log presence status
  console.log("Environment validation complete:");
  console.log("  - LEGAL_TERMS_HMAC_SECRET:", legalSecret && legalSecret.length >= 32 ? "configured" : "MISSING/TOO SHORT");
  console.log("  - RESEND_API_KEY:", process.env.RESEND_API_KEY ? "configured" : "MISSING");
  console.log("  - TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? "configured" : "MISSING");
  console.log("  - TWILIO_AUTH_TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "configured" : "MISSING");
  console.log("  - TWILIO_MESSAGING_SERVICE_SID:", process.env.TWILIO_MESSAGING_SERVICE_SID ? "configured" : "MISSING");
  console.log("  - TWILIO_FROM_NUMBER:", process.env.TWILIO_FROM_NUMBER ? "configured" : "MISSING");
  console.log("  - 1Forge API Key:", process.env.FORGE_KEY ? "configured" : "MISSING");
  console.log("  - DB_DIALECT:", dbDialect);
  console.log("  - DATABASE_URL:", process.env.DATABASE_URL ? "configured" : "MISSING");
  
  // ALWAYS fail fast on critical security errors (both dev and prod)
  if (criticalErrors.length > 0) {
    console.error("[FATAL] Missing CRITICAL security environment variables:");
    criticalErrors.forEach(e => console.error(`  - ${e}`));
    console.error("Server startup aborted. These secrets are required for security compliance.");
    process.exit(1);
  }
  
  // In production, fail fast if verification secrets are missing
  if (isProduction && warnings.length > 0) {
    console.error("[FATAL] Missing critical environment variables in production:");
    warnings.forEach(w => console.error(`  - ${w}`));
    console.error("Server startup aborted. Please configure required secrets.");
    process.exit(1);
  }
  
  return { warnings };
}

validateEnvVars();

function parseRoles(raw: string): Set<string> {
  const roles = new Set(
    String(raw || "")
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean),
  );
  if (roles.size === 0) roles.add("monolith");
  if (roles.has("monolith") || roles.has("all")) {
    roles.add("api");
    roles.add("ws");
    roles.add("ingestor");
    roles.add("worker");
  }
  return roles;
}

const roles = parseRoles(process.env.APP_ROLE ?? "monolith");
const RUN_WORKER_TASKS = roles.has("worker");
const RUN_INGESTOR_TASKS = roles.has("ingestor");

console.log(`[Role] APP_ROLE=${process.env.APP_ROLE ?? "monolith"} => ${[...roles].join(",")}`);

const app = express();
app.set("trust proxy", 1);
if (app.get("env") !== "development") {
  app.use(compression());
}

// Lightweight health check - responds immediately before any middleware
// This ensures deployment health checks pass quickly
app.get("/", (req, res, next) => {
  // Only respond to health checks (no accept header or accepts html)
  const acceptHeader = req.headers.accept || "";
  if (!acceptHeader || acceptHeader === "*/*" || acceptHeader.includes("text/plain")) {
    return res.status(200).send("OK");
  }
  // Pass through to Vite/static handler for browser requests
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/ready", async (_req, res) => {
  const checks = {
    db: false,
    valkey: false,
  };
  try {
    await dbClient.query("SELECT 1");
    checks.db = true;
  } catch {
    checks.db = false;
  }

  const needsValkey = Boolean(process.env.VALKEY_URL);
  if (!needsValkey) {
    checks.valkey = true;
  } else {
    try {
      const v = getValkey();
      if (v) {
        await v.ping();
        checks.valkey = true;
      }
    } catch {
      checks.valkey = false;
    }
  }

  const ok = checks.db && checks.valkey;
  res.status(ok ? 200 : 503).json({ ok, ...checks });
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    console.error("Express error handler:", err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // DEFERRED INITIALIZATION: Run expensive operations AFTER server is listening
    // This ensures health checks pass quickly during deployment
    setImmediate(async () => {
      if (roles.has("api") || roles.has("ws")) {
        try {
          const { bootstrapQuoteHub } = await import("./services/quoteHub");
          const loaded = await bootstrapQuoteHub();
          log(`[QuoteHub] Bootstrap ${loaded ? "loaded" : "skipped"} from Valkey snapshot`);
        } catch (e) {
          console.warn("[QuoteHub] Bootstrap failed:", e);
        }
      }

      // Seed baseline legal terms + kick off ip2asn import (worker only)
      if (RUN_WORKER_TASKS) {
        try {
          await bootstrapDoc1Seed();
        } catch (e) {
          console.warn("[Legal] DOC1 bootstrap failed:", e);
        }

        try {
          const datasetPath = getIp2AsnDatasetPath();
          if (datasetPath) {
            void (async () => {
              try {
                await withGriftClient(async (db) => {
                  await maybeImportIp2AsnDataset(db, { filePath: datasetPath });
                });
              } catch (err) {
                console.error("[Grift] Failed to import ip2asn dataset:", err);
              }
            })();
          }
        } catch (asnErr) {
          console.error("[Grift] Failed to evaluate/import ip2asn dataset:", asnErr);
        }
      } else {
        log("[Role] Skipping bootstrap tasks (worker only).");
      }

      // i18n: ingest built manifest (if present) and start worker
      if (RUN_WORKER_TASKS) {
        try {
          const ing = await maybeIngestBuiltManifest();
          if ((ing as any)?.ingested) console.log("[i18n] Ingested built manifest:", ing);
          else console.log("[i18n] Built manifest ingest skipped:", ing);
        } catch (e) {
          console.warn("[i18n] Built manifest ingest failed:", e);
        }
        try {
          startI18nWorker(30_000);
          console.log("[i18n] Worker started");
        } catch (e) {
          console.warn("[i18n] Worker failed to start:", e);
        }
      } else {
        log("[Role] Skipping i18n worker (worker only).");
      }

      // Import feed/cron AFTER schema is ensured
      if (RUN_INGESTOR_TASKS) {
        try {
          const { startQuoteFeed } = await import("./feeds/quoteFeed");
          await startQuoteFeed();
          const { startAutoCloseScheduler } = await import("./cron/autoClose");
          await startAutoCloseScheduler();
          log("Price feed and auto-close services initialized");
        } catch (error) {
          console.error("Error initializing feed/cron services:", error);
        }
      } else {
        log("[Role] Skipping quote feed/auto-close (ingestor only).");
      }

      // Initialize admin data views and tables
      if (RUN_WORKER_TASKS) {
        try {
          await setupAdminViews();
          log("Admin data views and tables initialized successfully");
        } catch (error) {
          console.error("Error setting up admin views:", error);
        }
      } else {
        log("[Role] Skipping admin views init (worker only).");
      }

      // Start grift detection scheduler
      if (RUN_WORKER_TASKS) {
        try {
          startGriftEvaluationScheduler();
          log("Grift detection scheduler initialized");
        } catch (error) {
          console.error("Error starting grift scheduler:", error);
        }
      } else {
        log("[Role] Skipping grift scheduler (worker only).");
      }

      // Start verification reminder cron
      if (RUN_WORKER_TASKS) {
        try {
          startVerificationReminderCron();
          log("Verification reminder cron initialized");
        } catch (error) {
          console.error("Error starting verification reminder cron:", error);
        }
      } else {
        log("[Role] Skipping verification reminder cron (worker only).");
      }

      // Start account lifecycle sweep scheduler (inactive users + deletion grace)
      if (RUN_WORKER_TASKS) {
        try {
          startAccountLifecycleSweepScheduler();
          log("Account lifecycle sweep scheduler initialized");
        } catch (error) {
          console.error("Error starting account lifecycle sweep scheduler:", error);
        }
      } else {
        log("[Role] Skipping account lifecycle sweep (worker only).");
      }
      
      log("Deferred initialization complete");
    });
  });
})();
