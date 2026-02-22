import type { Express } from "express";
import type { Server } from "http";
import session from "express-session";
import { resolveSessionStore } from "./services/sessionStore";
import { registerAdminRoutes } from "./routes/admin";
import { registerMarketRoutes } from "./routes/market";
import instrumentsRouter from "./routes/instruments";
import { profileMfaRouter } from "./routes/profileMfa";
import { verificationRouter } from "./routes/verification";
import legalRouter from "./routes/legal";
import adminLegalRouter from "./routes/adminLegal";
import { adminLegalDocsRouter } from "./routes/adminLegalDocs";
import { adminLegalAcceptancesRouter } from "./routes/adminLegalAcceptances";
import { adminMarketDataRouter } from "./routes/adminMarketData";
import { adminSystemConfigRouter } from "./routes/adminSystemConfig";
import { adminMigrationRouter } from "./routes/adminMigration";
import { adminActivityRouter } from "./routes/adminActivity";
import { adminQuoteSubscriptionsRouter } from "./routes/adminQuoteSubscriptions";
import { registerMetaRoutes } from "./routes/meta";
import { registerMeSessionsRoutes } from "./routes/meSessions";
import { registerAdminSecurityRoutes } from "./routes/adminSecurity";
import { registerGriftRoutes } from "./routes/grift";
import { griftPublicRouter } from "./grift/griftPublicRouter";
import { impersonationGuard } from "./middleware/auth";
import { requireEnv } from "./lib/envUtils";
import { captchaSliderRouter } from "./routes/captchaSlider";
import { i18nRouter } from "./routes/i18n";
import { adminI18nRouter } from "./routes/adminI18n";
import { quoteSubscriptionsRouter } from "./routes/quoteSubscriptions";
import { jurisdictionSessionGuard } from "./middleware/jurisdictionSessionGuard";
import { mailboxRouter } from "./routes/mailbox";
import { notificationsRouter } from "./routes/notifications";
import { adminChallengesRouter, adminPartnersRouter, adminScoutRouter } from "./routes/adminScout";
import { partnerAuthRouter, partnerPortalRouter } from "./routes/partnerPortal";
import { traderTalentPublicRouter, traderTalentRouter } from "./routes/traderTalent";
import { createCsrfProtection } from "./security/csrf";
import { createPublicRouter } from "./routes/public";
import { createAuthRouter } from "./routes/auth";
import { createProfileRouter } from "./routes/profile";
import { createTraderRouter } from "./routes/trader";
import { initWebSocketServer } from "./routes/ws";
import { buildMiddleware } from "./context/buildMiddleware";
import type { RouterContext, WsBroadcast } from "./context/routerContext";

const SESSION_COOKIE_NAME = "connect.sid";
const SESSION_SECRET = requireEnv("SESSION_SECRET");

declare module "express-session" {
  interface SessionData {
    userId: number;
    email: string;
    isAdmin: boolean;
    isSuperAdmin?: boolean;
    adminResourceScopes?: Record<string, unknown>;
    csrfToken?: string;
    userCountryIso2?: string;
    ipCountryIso2?: string;
    isImpersonating?: boolean;
    realAdminId?: number;
    realAdminEmail?: string;
    realAdminIsSuperAdmin?: boolean;
    realAdminResourceScopes?: Record<string, unknown>;
    impersonatedUserId?: number;
    impersonationStartedAt?: number;
    captchaSlider?: {
      id: string;
      issuedAtMs: number;
      verifiedAtMs: number | null;
      consumedAtMs: number | null;
      ip?: string | null;
      userAgent?: string | null;
    } | null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const sessionStoreResolved = await resolveSessionStore();
  const sessionStore = sessionStoreResolved.store;
  console.log(`[Session] store=${sessionStoreResolved.kind}`);

  const cookieSecure =
    process.env.COOKIE_SECURE === "true"
      ? true
      : process.env.COOKIE_SECURE === "false"
        ? false
        : process.env.NODE_ENV === "production";

  app.use(
    session({
      store: sessionStore,
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      name: SESSION_COOKIE_NAME,
      cookie: {
        secure: cookieSecure,
        httpOnly: true,
        sameSite: (process.env.COOKIE_SAMESITE as "lax" | "strict" | "none") || "strict",
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );

  const csrfProtection = createCsrfProtection({
    sessionCookieName: SESSION_COOKIE_NAME,
  });

  app.use("/api", impersonationGuard);
  app.use("/api", jurisdictionSessionGuard);

  app.get("/api/csrf", csrfProtection.csrfTokenHandler);
  app.use("/api", csrfProtection.issueCsrfToken, csrfProtection.enforceCsrf);

  app.use("/api/captcha", captchaSliderRouter);

  const middleware = buildMiddleware();

  let wsBroadcast: WsBroadcast = () => {};
  const wsBroadcastProxy: WsBroadcast = (event, filter) => wsBroadcast(event, filter);

  const routerCtx: RouterContext = {
    sessionStore,
    sessionCookieName: SESSION_COOKIE_NAME,
    sessionSecret: SESSION_SECRET,
    middleware,
    wsBroadcast: wsBroadcastProxy,
  };

  app.use("/api", createPublicRouter());
  app.use(createAuthRouter(routerCtx));
  app.use(createProfileRouter(routerCtx));
  app.use(createTraderRouter(routerCtx));

  registerAdminRoutes(app);
  registerMarketRoutes(app);
  registerMetaRoutes(app);
  registerMeSessionsRoutes(app);
  registerAdminSecurityRoutes(app);
  app.use("/api/i18n", i18nRouter);
  app.use("/api/instruments", instrumentsRouter);
  app.use(profileMfaRouter);
  app.use("/api/verification", verificationRouter);
  app.use("/api/legal", legalRouter);
  app.use("/api/admin/legal-docs-v2", adminLegalDocsRouter);
  app.use("/api/admin/legal-acceptances", adminLegalAcceptancesRouter);
  app.use("/api/admin/market-data", adminMarketDataRouter);
  app.use("/api/admin/quote-subscriptions", adminQuoteSubscriptionsRouter);
  app.use("/api/admin/system-config", adminSystemConfigRouter);
  app.use("/api/admin/activity", adminActivityRouter);
  app.use("/api/admin/i18n", adminI18nRouter);
  app.use("/api/quote-subscriptions", quoteSubscriptionsRouter);
  app.use("/api/mailbox", mailboxRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/admin/scout", adminScoutRouter);
  app.use("/api/admin/challenges", adminChallengesRouter);
  app.use("/api/admin/partners", adminPartnersRouter);
  app.use("/api/partner", partnerAuthRouter);
  app.use("/api/partner", partnerPortalRouter);
  app.use("/api/trader", traderTalentPublicRouter);
  app.use("/api/trader", traderTalentRouter);
  registerGriftRoutes(app);
  app.use("/api/grift", griftPublicRouter);
  app.use("/api/admin/migration", adminMigrationRouter);
  app.use("/api/admin/legal-docs", adminLegalRouter);

  const wsRuntime = initWebSocketServer(app, routerCtx);

  wsBroadcast = (event, filter) => wsRuntime.broadcast(event, filter);

  return wsRuntime.httpServer;
}
