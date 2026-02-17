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
import { startTradeAuditVerificationCron } from "./cron/tradeAuditVerification";
import { startScoutMetricsCron } from "./cron/scoutMetrics";
import { startChallengeEvaluationCron } from "./cron/evaluateChallenges";
import { startPartnerAllocationSyncCron } from "./cron/syncPartnerAllocations";
import { startAccountLifecycleSweepScheduler } from "./services/accountLifecycleSweepScheduler";
import { getIp2AsnDatasetPath, maybeImportIp2AsnDataset } from "./grift/griftIp2AsnDataset";
import { startI18nWorker } from "./i18n/worker";
import { maybeIngestBuiltManifest } from "./i18n/service";
import { dbDialect } from "@db/config";
import { dbClient } from "@db";
import { getValkey } from "./services/valkey";
import { withGriftClient } from "./grift/griftDb";

const REQUIRED_TRADE_GUARD_TRIGGERS = [
  "tradequip_no_delete_trades",
  "tradequip_no_truncate_trades",
  "tradequip_no_delete_trade_audit",
  "tradequip_no_truncate_trade_audit",
  "tradequip_no_delete_order_intent_audit",
  "tradequip_no_truncate_order_intent_audit",
] as const;

async function assertTradeLedgerGuardrails() {
  try {
    const res = await dbClient.query(
      `
        SELECT tgname, tgenabled
        FROM pg_trigger
        WHERE NOT tgisinternal AND tgname = ANY($1::text[])
      `,
      [REQUIRED_TRADE_GUARD_TRIGGERS],
    );

    const enabledByName = new Map<string, string>();
    for (const row of res.rows ?? []) {
      enabledByName.set(String((row as any).tgname), String((row as any).tgenabled));
    }

    const missing: string[] = [];
    const disabled: string[] = [];
    for (const name of REQUIRED_TRADE_GUARD_TRIGGERS) {
      const state = enabledByName.get(name);
      if (!state) missing.push(name);
      else if (state === "D") disabled.push(name);
    }

    if (missing.length || disabled.length) {
      console.error("[FATAL] Trade ledger guardrails are missing/disabled.");
      if (missing.length) console.error("  - Missing triggers:", missing.join(", "));
      if (disabled.length) console.error("  - Disabled triggers:", disabled.join(", "));
      console.error("Fix: run `npm run db:migrate:drizzle` and `npm run db:audit` before starting the server.");
      process.exit(1);
    }
  } catch (e) {
    console.error("[FATAL] Failed to verify trade ledger guardrails:", e);
    console.error("Refusing to start without confirming trade-history anti-wipe triggers.");
    process.exit(1);
  }
}

// Validate required environment variables at startup
function validateEnvVars() {
  const warnings: string[] = [];
  const criticalErrors: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";
  const encryptionKeyRaw = String(process.env.ENCRYPTION_KEY ?? "").trim();
  const encryptionKeyValid = /^[a-fA-F0-9]{64}$/.test(encryptionKeyRaw);
  
  // CRITICAL: Legal terms HMAC secret (required for tamper-evident token signing)
  const legalSecret = process.env.LEGAL_TERMS_HMAC_SECRET;
  if (!legalSecret || legalSecret.length < 32) {
    criticalErrors.push(
      "LEGAL_TERMS_HMAC_SECRET not configured or too short (min 32 chars) - " +
      "legal compliance tokens cannot be signed. Generate with: openssl rand -hex 32"
    );
  }

  // CRITICAL: Session secret (required for cookie signing)
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    criticalErrors.push(
      "SESSION_SECRET not configured - session cookies cannot be signed safely. " +
      "Generate with: openssl rand -hex 32"
    );
  } else if (sessionSecret.length < 32) {
    warnings.push("SESSION_SECRET is shorter than 32 chars - rotate to a stronger secret for production.");
  }

  // Email verification token secret (recommended; required for production hardening)
  const emailVerifyTokenSecret = process.env.EMAIL_VERIFY_TOKEN_SECRET;
  if (isProduction && !emailVerifyTokenSecret) {
    warnings.push("EMAIL_VERIFY_TOKEN_SECRET not configured - email verification token hashing is not keyed.");
  } else if (emailVerifyTokenSecret && emailVerifyTokenSecret.length < 32) {
    warnings.push("EMAIL_VERIFY_TOKEN_SECRET is shorter than 32 chars - rotate to a stronger secret for production.");
  }

  // CRITICAL: At-rest encryption key for mailbox/notification and security secrets.
  if (!encryptionKeyValid) {
    const message =
      "ENCRYPTION_KEY not configured as 64 hex chars (32-byte key). " +
      "Generate with: openssl rand -hex 32";
    if (isProduction) criticalErrors.push(message);
    else warnings.push(message);
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
  console.log("  - SESSION_SECRET:", sessionSecret ? "configured" : "MISSING");
  console.log("  - EMAIL_VERIFY_TOKEN_SECRET:", emailVerifyTokenSecret ? "configured" : "MISSING");
  console.log("  - ENCRYPTION_KEY:", encryptionKeyValid ? "configured" : "MISSING/INVALID");
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

function envFlagEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function isRequestTransportSecure(req: Request): boolean {
  if (Boolean(req.secure)) return true;
  const xfProtoRaw = req.headers["x-forwarded-proto"];
  const xfProto = Array.isArray(xfProtoRaw) ? xfProtoRaw[0] : String(xfProtoRaw ?? "");
  const firstProto = xfProto.split(",")[0]?.trim().toLowerCase();
  return firstProto === "https" || firstProto === "wss";
}

const isProdRuntime = process.env.NODE_ENV === "production";
const transportHeadersEnabled = envFlagEnabled(process.env.TRANSPORT_HEADERS_ENABLED, true);
const transportTlsRequired = envFlagEnabled(
  process.env.TRANSPORT_REQUIRE_TLS,
  isProdRuntime && process.env.COOKIE_SECURE !== "false",
);
const transportHstsEnabled = envFlagEnabled(process.env.TRANSPORT_HSTS_ENABLED, isProdRuntime);
const transportHstsIncludeSubdomains = envFlagEnabled(process.env.TRANSPORT_HSTS_INCLUDE_SUBDOMAINS, true);
const transportHstsPreload = envFlagEnabled(process.env.TRANSPORT_HSTS_PRELOAD, true);
const transportHstsMaxAgeSec = (() => {
  const parsed = Number(process.env.TRANSPORT_HSTS_MAX_AGE_SEC ?? 31536000);
  if (!Number.isFinite(parsed)) return 31536000;
  return Math.max(300, Math.min(63072000, Math.trunc(parsed)));
})();

app.use((req, res, next) => {
  if (transportHeadersEnabled) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    if (transportHstsEnabled && isRequestTransportSecure(req)) {
      const directives = [`max-age=${transportHstsMaxAgeSec}`];
      if (transportHstsIncludeSubdomains) directives.push("includeSubDomains");
      if (transportHstsPreload) directives.push("preload");
      res.setHeader("Strict-Transport-Security", directives.join("; "));
    }
  }
  next();
});

app.use("/api", (req, res, next) => {
  if (!transportTlsRequired) return next();
  if (isRequestTransportSecure(req)) return next();

  // Keep health probes available if deployment intentionally performs plain HTTP checks internally.
  if (req.path === "/status" || req.path === "/health") return next();

  return res.status(426).json({
    message: "TLS_REQUIRED",
    code: "TRANSPORT_TLS_REQUIRED",
  });
});

// Lightweight health check - responds immediately before any middleware
app.get("/status", (_req, res) => {
  res.status(200).send("OK");
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
  const captureBodies = app.get("env") === "development" && process.env.LOG_API_BODIES === "1";
  let capturedJsonResponse: unknown = undefined;

  if (captureBodies) {
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (captureBodies && capturedJsonResponse !== undefined) {
        try {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        } catch {
          // ignore stringify issues
        }
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
  await assertTradeLedgerGuardrails();
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const isProd = process.env.NODE_ENV === "production";
    const safeMessage = status >= 500 && isProd ? "Internal Server Error" : message;

    if (!res.headersSent) {
      res.status(status).json({ message: safeMessage });
    }
    console.error("Express error handler:", err);
  });

  // Prevent SPA fallthrough from masking missing API routes.
  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Not found" });
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
  const reusePortEnabled =
    process.env.NODE_ENV === "production" &&
    String(process.env.SERVER_REUSE_PORT ?? "0").trim() === "1";
  server.listen({
    port,
    host: "0.0.0.0",
    ...(reusePortEnabled ? { reusePort: true } : {}),
  }, () => {
    log(`serving on port ${port}`);
    if (reusePortEnabled) {
      log("[Server] reusePort is enabled (SERVER_REUSE_PORT=1). Ensure all listeners run identical code.");
    }
    
    // DEFERRED INITIALIZATION: Run expensive operations AFTER server is listening
    // This ensures health checks pass quickly during deployment
    setImmediate(async () => {
      if (roles.has("api") || roles.has("ws")) {
        try {
          const { bootstrapQuoteHub, bootstrapQuoteHubFromValkeySymbols } = await import("./services/quoteHub");
          const loaded = await bootstrapQuoteHub();
          log(`[QuoteHub] Bootstrap ${loaded ? "loaded" : "skipped"} from Valkey snapshot`);

          if (!loaded) {
            try {
              const symbolsRes = await dbClient.query("SELECT symbol FROM symbol_configs WHERE enabled = true");
              const symbols = symbolsRes.rows.map((r: any) => String(r.symbol)).filter(Boolean);
              if (symbols.length) {
                const loadedKeys = await bootstrapQuoteHubFromValkeySymbols(symbols);
                log(`[QuoteHub] Bootstrap ${loadedKeys ? "loaded" : "skipped"} from Valkey per-symbol keys`);
              }
            } catch (e) {
              console.warn("[QuoteHub] Per-symbol bootstrap failed:", e);
            }
          }
        } catch (e) {
          console.warn("[QuoteHub] Bootstrap failed:", e);
        }
      }

      // Market data provider configs: optionally sync provider definitions from filesystem JSON.
      // This is safe-by-default (create_missing) unless overridden via env.
      try {
        const enabled = String(process.env.MARKET_DATA_PROVIDER_FILE_SYNC ?? "").trim() === "1";
        if (enabled && (roles.has("api") || roles.has("ingestor"))) {
          const { syncProviderConfigsFromDirToDb } = await import("./marketdata/providerConfigFiles");
          const synced = await syncProviderConfigsFromDirToDb();
          const changed = (synced.createdKeys?.length ?? 0) + (synced.updatedKeys?.length ?? 0);
          if (synced.errors?.length) {
            console.warn(`[MarketData] Provider file sync completed with ${synced.errors.length} error(s).`);
          } else {
            console.log("[MarketData] Provider file sync OK.");
          }
          if (changed > 0) {
            console.log(
              `[MarketData] Provider file sync applied (created=${synced.createdKeys.length}, updated=${synced.updatedKeys.length}, skipped=${synced.skippedKeys.length})`,
            );
          }
        }
      } catch (e) {
        console.warn("[MarketData] Provider file sync failed:", e);
      }

      // Market data provider health: warn early if configured providers reference missing env secrets.
      try {
        const { checkConfiguredProviderSecrets } = await import("./marketdata/providerManager");
        const status = await checkConfiguredProviderSecrets();
        const missing = status.missingEnvByProviderKey ?? {};
        const missingKeys = Object.keys(missing);
        if (missingKeys.length) {
          console.warn("[MarketData] Configured provider secrets missing from process.env:");
          for (const providerKey of missingKeys) {
            console.warn(`  - ${providerKey}: ${(missing as any)[providerKey].join(", ")}`);
          }
        }
      } catch (e) {
        console.warn("[MarketData] Provider secret preflight failed:", e);
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

      // Start trade audit-chain verification cron
      if (RUN_WORKER_TASKS) {
        try {
          startTradeAuditVerificationCron();
          log("Trade audit verification cron initialized");
        } catch (error) {
          console.error("Error starting trade audit verification cron:", error);
        }
      } else {
        log("[Role] Skipping trade audit verification cron (worker only).");
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

      // Start nightly scout metrics calculation scheduler
      if (RUN_WORKER_TASKS) {
        try {
          startScoutMetricsCron();
          log("Scout metrics cron initialized");
        } catch (error) {
          console.error("Error starting scout metrics cron:", error);
        }
      } else {
        log("[Role] Skipping scout metrics cron (worker only).");
      }

      // Start challenge evaluation scheduler
      if (RUN_WORKER_TASKS) {
        try {
          startChallengeEvaluationCron();
          log("Challenge evaluation cron initialized");
        } catch (error) {
          console.error("Error starting challenge evaluation cron:", error);
        }
      } else {
        log("[Role] Skipping challenge evaluation cron (worker only).");
      }

      // Start partner allocation sync scheduler
      if (RUN_WORKER_TASKS) {
        try {
          startPartnerAllocationSyncCron();
          log("Partner allocation sync cron initialized");
        } catch (error) {
          console.error("Error starting partner allocation sync cron:", error);
        }
      } else {
        log("[Role] Skipping partner allocation sync cron (worker only).");
      }
      
      log("Deferred initialization complete");
    });
  });
})();
