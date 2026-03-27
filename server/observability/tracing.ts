import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { context, diag, DiagConsoleLogger, DiagLogLevel, propagation, SpanKind, SpanStatusCode, trace, type Attributes, type Context, type Link, type Span } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, ParentBasedSampler, SamplingDecision, TraceIdRatioBasedSampler, type Sampler, type SamplingResult } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

type TraceContextLabels = {
  traceID: string | null;
  spanID: string | null;
};

const TRACE_ENABLED = envFlagEnabled(process.env.OTEL_TRACING_ENABLED, process.env.NODE_ENV === "production");
const TRACE_SERVICE_NAME = String(process.env.OTEL_SERVICE_NAME || `tradehub-${process.env.APP_ROLE || "monolith"}`).trim();
const TRACE_EXPORTER_ENDPOINT = String(
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    "http://tradehub-victoria-traces.tradehub.svc.cluster.local:10428/insert/opentelemetry/v1/traces",
).trim();
const TRACE_PRIORITY_OPERATIONS = new Set([
  "auth.login",
  "auth.register",
  "partner.onboarding.profile",
  "partner.onboarding.legal",
  "partner.onboarding.request_contact",
  "trade.open",
  "trade.close",
  "trade.cancel",
  "admin.data_exports.create",
  "admin.data_exports.retry",
]);
const tracer = trace.getTracer("tradehub-observability");

let tracingInitialized = false;

function envFlagEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

class TradehubRouteAwareSampler implements Sampler {
  private readonly defaultSampler: Sampler;
  private readonly prioritySampler: Sampler;

  constructor(defaultRatio: number, priorityRatio: number) {
    this.defaultSampler = new TraceIdRatioBasedSampler(defaultRatio);
    this.prioritySampler = new TraceIdRatioBasedSampler(priorityRatio);
  }

  shouldSample(
    parentContext: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    const operation = String(attributes["tradehub.operation"] ?? spanName ?? "").trim().toLowerCase();
    if (TRACE_PRIORITY_OPERATIONS.has(operation)) {
      return this.prioritySampler.shouldSample(parentContext, traceId, spanName, spanKind, attributes, links);
    }
    return this.defaultSampler.shouldSample(parentContext, traceId, spanName, spanKind, attributes, links);
  }

  toString(): string {
    return "TradehubRouteAwareSampler";
  }
}

export function initTracing(): void {
  if (tracingInitialized || !TRACE_ENABLED) return;
  tracingInitialized = true;

  if (envFlagEnabled(process.env.OTEL_DIAGNOSTIC_LOGGING, false)) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: TRACE_SERVICE_NAME,
      "deployment.environment": process.env.NODE_ENV || "development",
      "tradehub.role": process.env.APP_ROLE || "monolith",
    }),
    sampler: new ParentBasedSampler({
      root: new TradehubRouteAwareSampler(0.01, 0.1),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: TRACE_EXPORTER_ENDPOINT,
        }),
        {
          maxQueueSize: 1024,
          maxExportBatchSize: 256,
          scheduledDelayMillis: 5000,
          exportTimeoutMillis: 15000,
        },
      ),
    ],
  });

  provider.register({
    contextManager: new AsyncLocalStorageContextManager(),
  });
}

export function startHttpRequestSpan(params: {
  operation: string;
  routeTemplate: string;
  method: string;
  path: string;
  correlationId: string;
}): { span: Span | null; ctx: Context } {
  if (!TRACE_ENABLED) {
    return { span: null, ctx: context.active() };
  }

  const span = tracer.startSpan(params.operation, {
    kind: SpanKind.SERVER,
    attributes: {
      "http.method": params.method,
      "url.path": params.path,
      "http.route": params.routeTemplate,
      "tradehub.operation": params.operation,
      "tradehub.correlation_id": params.correlationId,
    },
  });
  const ctx = trace.setSpan(context.active(), span);
  return { span, ctx };
}

export async function withObservedSpan<T>(params: {
  name: string;
  attributes?: Attributes;
  fn: () => Promise<T>;
}): Promise<T> {
  if (!TRACE_ENABLED) return params.fn();
  return tracer.startActiveSpan(params.name, { attributes: params.attributes }, async (span) => {
    try {
      const result = await params.fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(error?.message || error || "span_failed"),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function completeHttpRequestSpan(params: {
  span: Span | null;
  routeTemplate: string;
  operation: string;
  statusCode: number;
  statusClass: string;
}): void {
  if (!params.span) return;
  params.span.updateName(params.operation);
  params.span.setAttributes({
    "http.route": params.routeTemplate,
    "tradehub.operation": params.operation,
    "http.response.status_code": params.statusCode,
    "tradehub.status_class": params.statusClass,
  });
  if (params.statusCode >= 500) {
    params.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `HTTP ${params.statusCode}`,
    });
  } else {
    params.span.setStatus({ code: SpanStatusCode.OK });
  }
  params.span.end();
}

export function annotateSpanFailure(operation: string, reason: string): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent("tradehub.operation_failure", {
    "tradehub.operation": operation,
    "tradehub.reason": reason,
  });
}

export function currentTraceContextLabels(): TraceContextLabels {
  const span = trace.getActiveSpan();
  if (!span) return { traceID: null, spanID: null };
  const ctx = span.spanContext();
  if (!ctx?.traceId || !ctx?.spanId) return { traceID: null, spanID: null };
  return {
    traceID: ctx.traceId,
    spanID: ctx.spanId,
  };
}

export function setSpanAttributes(attributes: Attributes): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttributes(attributes);
}

export function bindRequestContext<T>(ctx: Context, fn: () => T): T {
  return context.with(ctx, fn);
}

export function injectTraceHeaders(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}
