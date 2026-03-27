import type { NextFunction, Request, Response } from "express";
import { getOrCreateCorrelationId } from "../lib/auditContext";
import { changeHttpRequestsInFlight, observeHttpRequestMetric } from "../routes/metricsState";
import {
  bindRequestContext,
  completeHttpRequestSpan,
  currentTraceContextLabels,
  injectTraceHeaders,
  setSpanAttributes,
  startHttpRequestSpan,
} from "./tracing";

const OPERATION_OVERRIDES = new Map<string, string>([
  ["POST /api/auth/login", "auth.login"],
  ["POST /api/auth/register", "auth.register"],
  ["POST /api/legal/doc1/accept", "legal.doc1_accept"],
  ["GET /api/legal/doc1/reaccept", "legal.doc1_reaccept_status"],
  ["POST /api/partner/onboarding/profile", "partner.onboarding.profile"],
  ["POST /api/partner/onboarding/legal", "partner.onboarding.legal"],
  ["POST /api/partner/onboarding/request-contact", "partner.onboarding.request_contact"],
  ["GET /api/partner/onboarding/state", "partner.onboarding.state"],
  ["POST /api/trades", "trade.open"],
  ["POST /api/trades/:id/close", "trade.close"],
  ["PATCH /api/trades/:id/cancel", "trade.cancel"],
  ["PATCH /api/trades/:id/targets", "trade.targets"],
  ["POST /api/admin/data-exports", "admin.data_exports.create"],
  ["POST /api/admin/data-exports/:jobId/retry", "admin.data_exports.retry"],
  ["GET /api/admin/data-exports", "admin.data_exports.list"],
  ["GET /api/admin/data-exports/:jobId/download-link", "admin.data_exports.download_link"],
  ["GET /api/admin/data-exports/:jobId/events", "admin.data_exports.events"],
  ["GET /api/admin/data-exports/:jobId", "admin.data_exports.detail"],
  ["GET /api/admin/kpi-summary", "admin.rollups.kpi_summary"],
  ["GET /api/admin/signup-funnel", "admin.rollups.signup_funnel"],
  ["GET /api/admin/user-analytics", "admin.rollups.user_analytics"],
  ["GET /api/admin/analytics/compliance", "admin.rollups.compliance"],
  ["GET /api/admin/deactivated-accounts/summary", "admin.rollups.deactivated_summary"],
  ["POST /api/trader/challenges/:id/enroll", "challenge.enroll"],
  ["POST /api/trader/challenges/:id/withdraw", "challenge.withdraw"],
]);

type RequestContextState = {
  correlationId: string;
  startedAtMs: number;
  routeTemplate: string;
  operation: string;
  inFlightKey: {
    method: string;
    route: string;
    operation: string;
  };
  span: ReturnType<typeof startHttpRequestSpan>["span"];
};

function shouldObserveRequest(req: Request): boolean {
  const path = String(req.path || req.originalUrl || "");
  if (!path.startsWith("/api")) return false;
  return !(
    path === "/metrics" ||
    path === "/status" ||
    path === "/health" ||
    path === "/ready" ||
    path.startsWith("/ws")
  );
}

function normalizeFallbackPath(path: string): string {
  const segments = String(path || "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8,}$/i.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
      if (segment.length > 48) return ":id";
      return segment;
    });
  return `/${segments.join("/")}` || "/";
}

function resolveRouteTemplate(req: Request): string {
  const route = (req as any).route?.path;
  const baseUrl = String(req.baseUrl || "");
  if (typeof route === "string") {
    return joinRoute(baseUrl, route);
  }
  if (Array.isArray(route) && typeof route[0] === "string") {
    return joinRoute(baseUrl, route[0]);
  }
  return normalizeFallbackPath(String(req.path || req.originalUrl || "/"));
}

function joinRoute(baseUrl: string, routePath: string): string {
  const combined = `${baseUrl || ""}${routePath || ""}`.replace(/\/+/g, "/");
  return combined.startsWith("/") ? combined : `/${combined}`;
}

function resolveOperation(method: string, routeTemplate: string): string {
  const lookupKey = `${method.toUpperCase()} ${routeTemplate}`;
  const override = OPERATION_OVERRIDES.get(lookupKey);
  if (override) return override;

  const segments = routeTemplate
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment
        .replace(/^:/, "by_")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);

  if (segments.length === 0) return `http.${method.toLowerCase()}`;
  return [...segments].join(".");
}

function resolveStatusClass(statusCode: number): string {
  const hundreds = Math.max(1, Math.min(5, Math.trunc(Number(statusCode) / 100)));
  return `${hundreds}xx`;
}

export function installHttpObservabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!shouldObserveRequest(req)) {
    next();
    return;
  }

  const method = String(req.method || "GET").toUpperCase();
  const correlationId = getOrCreateCorrelationId(req);
  const initialRouteTemplate = normalizeFallbackPath(String(req.path || req.originalUrl || "/"));
  const initialOperation = resolveOperation(method, initialRouteTemplate);
  const { span, ctx } = startHttpRequestSpan({
    operation: initialOperation,
    routeTemplate: initialRouteTemplate,
    method,
    path: String(req.path || req.originalUrl || "/"),
    correlationId,
  });

  bindRequestContext(ctx, () => {
    setSpanAttributes({
      "tradehub.correlation_id": correlationId,
    });

    const traceLabels = currentTraceContextLabels();
    res.setHeader("x-correlation-id", correlationId);
    if (traceLabels.traceID) {
      res.setHeader("x-trace-id", traceLabels.traceID);
    }
    if (traceLabels.spanID) {
      res.setHeader("x-span-id", traceLabels.spanID);
    }
    const traceCarrier: Record<string, string> = {};
    injectTraceHeaders(traceCarrier);
    for (const [header, value] of Object.entries(traceCarrier)) {
      if (!value) continue;
      res.setHeader(header, value);
    }

    const state: RequestContextState = {
      correlationId,
      startedAtMs: Date.now(),
      routeTemplate: initialRouteTemplate,
      operation: initialOperation,
      inFlightKey: {
        method,
        route: initialRouteTemplate,
        operation: initialOperation,
      },
      span,
    };

    (res.locals as any).__tradehubObservability = state;
    changeHttpRequestsInFlight({
      method,
      route: initialRouteTemplate,
      operation: initialOperation,
      delta: 1,
    });

    res.on("finish", () => {
      const finishedRouteTemplate = resolveRouteTemplate(req);
      const finishedOperation = resolveOperation(method, finishedRouteTemplate);
      const statusCode = Number(res.statusCode || 200);
      const statusClass = resolveStatusClass(statusCode);
      state.routeTemplate = finishedRouteTemplate;
      state.operation = finishedOperation;

      changeHttpRequestsInFlight({
        method,
        route: state.inFlightKey.route,
        operation: state.inFlightKey.operation,
        delta: -1,
      });

      bindRequestContext(ctx, () => {
        setSpanAttributes({
          "http.route": finishedRouteTemplate,
          "tradehub.operation": finishedOperation,
        });
        const traceContext = currentTraceContextLabels();
        observeHttpRequestMetric({
          route: finishedRouteTemplate,
          durationSec: Math.max(0, (Date.now() - state.startedAtMs) / 1000),
          method,
          statusCode,
          statusClass,
          operation: finishedOperation,
          traceID: traceContext.traceID,
          spanID: traceContext.spanID,
        });
        completeHttpRequestSpan({
          span,
          routeTemplate: finishedRouteTemplate,
          operation: finishedOperation,
          statusCode,
          statusClass,
        });
      });
    });

    next();
  });
}
