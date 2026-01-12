// @ts-nocheck
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
// Import and initialize admin data views
import { main as setupAdminViews } from "../db/create_admin_views";
// Import schema migration helper
import { ensureCoreTradingSchema, ensureTradeCloseAuditColumns, ensureQuotesColumns, ensureTradeAuditTable, ensureUserSettingsColumns, ensureGlobalSettingsTable, ensureUsersColumns, ensureSystemConfigTable, ensureMarketDailyCloseTable, ensureUserLoginHistoryTable, ensureUserAccountEventsTable, ensureUserAdminNotesTable, ensureLoginHistorySessionColumns, ensureTraderJournalTable, ensureAdminActionsTable, ensureInstitutionalAuditColumns, ensureOrderIntentAuditTable, ensureTradesProvenanceColumns, ensureAuditExportManifestTable, ensureMigrationTables, ensureUserSessionsTable, ensureTieredAccessSchema, ensureUserSessionGeoColumns, ensureLoginHistoryGeoColumns, ensureUserSessionIdentityColumns, ensureLoginHistoryIdentityColumns, ensureLegalComplianceSchema, ensureSignupFreezeWaitlistSchema, ensureSignupFingerprintSchema, ensureDailyFxClosesSchema, ensureI18nSchema, ensureAccountLifecycleSchema } from "./db/ensureSchema";
import { bootstrapDoc1Seed } from "./legal/bootstrapDoc1Seed";
import { startGriftEvaluationScheduler } from "./grift/griftScheduler";
import { startVerificationReminderCron } from "./cron/verificationReminders";
import { startAccountLifecycleSweepScheduler } from "./services/accountLifecycleSweepScheduler";
import BetterSQLite3 from "better-sqlite3";
import { getIp2AsnDatasetPath, maybeImportIp2AsnDataset } from "./grift/griftIp2AsnDataset";
import { startI18nWorker } from "./i18n/worker";
import { maybeIngestBuiltManifest } from "./i18n/service";
import { dbDialect, isPostgres } from "@db/config";

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
  console.log("  - DATABASE_URL:", isPostgres ? (process.env.DATABASE_URL ? "configured" : "MISSING") : "sqlite");
  
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

const app = express();
app.set("trust proxy", 1);

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
      // Ensure schema columns exist before starting cron/feeds
      if (!isPostgres) {
        try {
          ensureCoreTradingSchema();
          ensureQuotesColumns();
          ensureTradeCloseAuditColumns();
          ensureTradeAuditTable();
          ensureInstitutionalAuditColumns();
          ensureOrderIntentAuditTable();
          ensureUserSettingsColumns();
          ensureGlobalSettingsTable();
          ensureUsersColumns();
          ensureSystemConfigTable();
          ensureMarketDailyCloseTable();
          ensureUserLoginHistoryTable();
          ensureLoginHistorySessionColumns();
          ensureUserAccountEventsTable();
          ensureUserAdminNotesTable();
          ensureTraderJournalTable();
          ensureAdminActionsTable();
          ensureUserSessionsTable();
          ensureUserSessionIdentityColumns();
          ensureUserSessionGeoColumns();
          ensureLoginHistoryIdentityColumns();
          ensureLoginHistoryGeoColumns();
          ensureTradesProvenanceColumns();
          ensureAuditExportManifestTable();
          ensureMigrationTables();
          ensureTieredAccessSchema();
          ensureLegalComplianceSchema();
          ensureSignupFreezeWaitlistSchema();
          ensureSignupFingerprintSchema();
          ensureDailyFxClosesSchema();
          ensureI18nSchema();
          ensureAccountLifecycleSchema();
          bootstrapDoc1Seed();

          // Offline ASN/Org enrichment
          try {
            const datasetPath = getIp2AsnDatasetPath();
            if (datasetPath) {
              const asnDb = new BetterSQLite3("./trading_app.db");
              try { asnDb.pragma("busy_timeout = 5000"); } catch {}
              try {
                await maybeImportIp2AsnDataset(asnDb, { filePath: datasetPath });
              } finally {
                asnDb.close();
              }
            }
          } catch (asnErr) {
            console.error("[Grift] Failed to import ip2asn dataset:", asnErr);
          }
          
          log("Schema audit columns verified (institutional-grade)");
        } catch (error) {
          console.error("Error ensuring schema columns:", error);
        }
      } else {
        console.warn("[DB] Postgres mode: SQLite schema ensure/seed skipped. Apply Postgres migrations before use.");
      }

      if (!isPostgres) {
        // i18n: ingest built manifest (if present) and start worker
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

        // Import feed/cron AFTER schema is ensured
        try {
          await import("./feeds/forgeFeed");
          await import("./cron/autoClose");
          log("Price feed and auto-close services initialized");
        } catch (error) {
          console.error("Error initializing feed/cron services:", error);
        }

        // Initialize admin data views and tables
        try {
          await setupAdminViews();
          log("Admin data views and tables initialized successfully");
        } catch (error) {
          console.error("Error setting up admin data views:", error);
        }
        
        // Start grift detection scheduler
        try {
          startGriftEvaluationScheduler("./trading_app.db");
          log("Grift detection scheduler initialized");
        } catch (error) {
          console.error("Error starting grift scheduler:", error);
        }
      } else {
        console.warn("[DB] Postgres mode: SQLite-only i18n/feeds/admin views/grift schedulers are disabled.");
      }

      // Start verification reminder cron
      try {
        startVerificationReminderCron();
        log("Verification reminder cron initialized");
      } catch (error) {
        console.error("Error starting verification reminder cron:", error);
      }

      // Start account lifecycle sweep scheduler (inactive users + deletion grace)
      try {
        startAccountLifecycleSweepScheduler();
        log("Account lifecycle sweep scheduler initialized");
      } catch (error) {
        console.error("Error starting account lifecycle sweep scheduler:", error);
      }
      
      log("Deferred initialization complete");
    });
  });
})();
