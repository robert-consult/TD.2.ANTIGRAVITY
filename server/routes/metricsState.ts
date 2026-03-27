type MetricLabelValue = string | number | boolean | null | undefined;

type MetricLabels = Record<string, MetricLabelValue>;

type HistogramSeriesState = {
  labels: Record<string, string>;
  buckets: number[];
  sum: number;
  count: number;
  exemplars: Array<MetricExemplar | null>;
};

type MetricExemplar = {
  traceID: string;
  spanID: string;
  value: number;
  timestampMs: number;
};

type HttpRequestDurationState = {
  buckets: number[];
  sum: number;
  count: number;
};

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatMetricNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(12)));
}

function normalizeMetricLabelValue(value: MetricLabelValue, fallback = "unknown"): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  const normalized = raw.replace(/[^a-z0-9:_-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeRouteLabelValue(value: MetricLabelValue): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "/unknown";
  return raw.replace(/\s+/g, "_");
}

function buildSeriesKey(labelNames: string[], labels: Record<string, string>): string {
  return labelNames.map((name) => `${name}=${labels[name] ?? ""}`).join("\u001f");
}

function formatLabelSet(labels: Record<string, string>, extras: Record<string, string> = {}): string {
  const entries = Object.entries({ ...labels, ...extras });
  if (entries.length === 0) return "";
  return `{${entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(",")}}`;
}

class CounterVec {
  private readonly series = new Map<string, { labels: Record<string, string>; value: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[],
  ) {}

  inc(labels: MetricLabels = {}, value = 1): void {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return;
    const normalizedLabels = normalizeLabels(this.labelNames, labels);
    const key = buildSeriesKey(this.labelNames, normalizedLabels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += numericValue;
      return;
    }
    this.series.set(key, { labels: normalizedLabels, value: numericValue });
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    for (const series of this.series.values()) {
      lines.push(`${this.name}${formatLabelSet(series.labels)} ${formatMetricNumber(series.value)}`);
    }
    return lines;
  }
}

class GaugeVec {
  private readonly series = new Map<string, { labels: Record<string, string>; value: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[],
  ) {}

  set(labels: MetricLabels = {}, value: number): void {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    const normalizedLabels = normalizeLabels(this.labelNames, labels);
    const key = buildSeriesKey(this.labelNames, normalizedLabels);
    this.series.set(key, { labels: normalizedLabels, value: numericValue });
  }

  inc(labels: MetricLabels = {}, value = 1): void {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue === 0) return;
    const normalizedLabels = normalizeLabels(this.labelNames, labels);
    const key = buildSeriesKey(this.labelNames, normalizedLabels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += numericValue;
      return;
    }
    this.series.set(key, { labels: normalizedLabels, value: numericValue });
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];
    for (const series of this.series.values()) {
      lines.push(`${this.name}${formatLabelSet(series.labels)} ${formatMetricNumber(series.value)}`);
    }
    return lines;
  }
}

class HistogramVec {
  private readonly series = new Map<string, HistogramSeriesState>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[],
    readonly buckets: number[],
  ) {}

  observe(labels: MetricLabels = {}, value: number, exemplar?: MetricExemplar | null): void {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) return;

    const normalizedLabels = normalizeLabels(this.labelNames, labels);
    const key = buildSeriesKey(this.labelNames, normalizedLabels);
    let existing = this.series.get(key);
    if (!existing) {
      existing = {
        labels: normalizedLabels,
        buckets: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
        exemplars: new Array(this.buckets.length).fill(null),
      };
      this.series.set(key, existing);
    }

    existing.sum += numericValue;
    existing.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (numericValue <= this.buckets[i]) {
        existing.buckets[i] += 1;
      }
    }

    if (exemplar?.traceID) {
      const bucketIndex = this.buckets.findIndex((bound) => numericValue <= bound);
      if (bucketIndex >= 0) {
        existing.exemplars[bucketIndex] = exemplar;
      }
    }
  }

  snapshot(labelNames: string[] = this.labelNames): {
    bucketsSec: number[];
    series: Array<{ labels: Record<string, string>; buckets: number[]; sum: number; count: number }>;
  } {
    const series = Array.from(this.series.values()).map((row) => ({
      labels: labelNames.reduce<Record<string, string>>((acc, labelName) => {
        if (row.labels[labelName] != null) acc[labelName] = row.labels[labelName];
        return acc;
      }, {}),
      buckets: [...row.buckets],
      sum: row.sum,
      count: row.count,
    }));
    return { bucketsSec: [...this.buckets], series };
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const row of this.series.values()) {
      for (let i = 0; i < this.buckets.length; i++) {
        const bucketValue = formatMetricNumber(row.buckets[i]);
        const exemplar = row.exemplars[i];
        const exemplarSuffix = exemplar
          ? ` # {traceID="${escapeLabelValue(exemplar.traceID)}",spanID="${escapeLabelValue(exemplar.spanID)}"} ${formatMetricNumber(exemplar.value)}`
          : "";
        lines.push(
          `${this.name}_bucket${formatLabelSet(row.labels, { le: String(this.buckets[i]) })} ${bucketValue}${exemplarSuffix}`,
        );
      }
      lines.push(
        `${this.name}_bucket${formatLabelSet(row.labels, { le: "+Inf" })} ${formatMetricNumber(row.count)}`,
        `${this.name}_sum${formatLabelSet(row.labels)} ${formatMetricNumber(row.sum)}`,
        `${this.name}_count${formatLabelSet(row.labels)} ${formatMetricNumber(row.count)}`,
      );
    }
    return lines;
  }
}

function normalizeLabels(labelNames: string[], labels: MetricLabels): Record<string, string> {
  const out: Record<string, string> = {};
  for (const labelName of labelNames) {
    if (labelName === "route") {
      out[labelName] = normalizeRouteLabelValue(labels[labelName]);
      continue;
    }
    out[labelName] = normalizeMetricLabelValue(labels[labelName], "unknown");
  }
  return out;
}

const SERVICE_LABEL = normalizeMetricLabelValue(process.env.APP_ROLE ?? "monolith", "monolith");

let metricTradeCloseRejectedQuoteStaleTotal = 0;
let metricTradeTargetsRejectedQuoteStaleTotal = 0;
let metricTradeOpenRejectedQuoteRevalidationTotal = 0;
let metricTradeCloseRejectedQuoteRevalidationTotal = 0;
let metricWsQuotePermissionRefreshTotal = 0;
let metricWsQuotePermissionRefreshErrorsTotal = 0;
let metricWsOriginRejectedTotal = 0;
let metricWsUserConnectionLimitRejectedTotal = 0;
let metricWsMessageRateLimitedTotal = 0;

let metricLoginAttemptsFailedTotal = 0;
let metricLoginAttemptsSuccessTotal = 0;
let metricHttpResponses403CsrfTotal = 0;
let metricBotChallengesIssuedTotal = 0;

const HTTP_REQUEST_DURATION_BUCKETS_SEC = [0.05, 0.1, 0.25, 0.5, 1, 2, 5];
const BUSINESS_FLOW_DURATION_BUCKETS_SEC = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15];
const JOB_DURATION_BUCKETS_SEC = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 30, 60, 120, 300];

const httpRequestDurationByRoute = new Map<string, HttpRequestDurationState>();
const httpRequestDurationHistogram = new HistogramVec(
  "http_request_duration_seconds",
  "Request duration histogram (server-side)",
  ["service", "method", "route", "status_class", "operation"],
  HTTP_REQUEST_DURATION_BUCKETS_SEC,
);
const httpRequestsTotal = new CounterVec(
  "http_requests_total",
  "HTTP requests observed by the application",
  ["service", "method", "route", "status_class", "operation"],
);
const httpRequestErrorsTotal = new CounterVec(
  "http_request_errors_total",
  "HTTP error responses observed by the application",
  ["service", "method", "route", "status_class", "operation"],
);
const httpRequestsInFlight = new GaugeVec(
  "http_requests_in_flight",
  "HTTP requests currently in flight",
  ["service", "method", "route", "operation"],
);
const businessFlowStepsTotal = new CounterVec(
  "business_flow_steps_total",
  "Business flow steps observed in live user journeys",
  ["service", "flow", "step", "outcome"],
);
const businessFlowStepDurationSeconds = new HistogramVec(
  "business_flow_step_duration_seconds",
  "Business flow step duration histogram",
  ["service", "flow", "step", "outcome"],
  BUSINESS_FLOW_DURATION_BUCKETS_SEC,
);
const operationFailuresTotal = new CounterVec(
  "operation_failures_total",
  "Bounded operation failures grouped by operation and reason",
  ["service", "operation", "reason"],
);
const backgroundJobRunsTotal = new CounterVec(
  "background_job_runs_total",
  "Background job runs grouped by job and outcome",
  ["service", "job", "outcome"],
);
const backgroundJobDurationSeconds = new HistogramVec(
  "background_job_duration_seconds",
  "Background job duration histogram",
  ["service", "job", "outcome"],
  JOB_DURATION_BUCKETS_SEC,
);
const backgroundJobRunning = new GaugeVec(
  "background_job_running",
  "Background jobs currently running",
  ["service", "job"],
);

export function incTradeCloseRejectedQuoteStaleTotal() {
  metricTradeCloseRejectedQuoteStaleTotal += 1;
  incOperationFailure("trade.close", "quote_stale");
}

export function incTradeTargetsRejectedQuoteStaleTotal() {
  metricTradeTargetsRejectedQuoteStaleTotal += 1;
  incOperationFailure("trade.targets", "quote_stale");
}

export function incTradeOpenRejectedQuoteRevalidationTotal() {
  metricTradeOpenRejectedQuoteRevalidationTotal += 1;
  incOperationFailure("trade.open", "quote_revalidation_failed");
}

export function incTradeCloseRejectedQuoteRevalidationTotal() {
  metricTradeCloseRejectedQuoteRevalidationTotal += 1;
  incOperationFailure("trade.close", "quote_revalidation_failed");
}

export function addWsQuotePermissionRefreshTotal(count: number) {
  metricWsQuotePermissionRefreshTotal += Math.max(0, Math.trunc(Number(count) || 0));
}

export function addWsQuotePermissionRefreshErrorsTotal(count: number) {
  metricWsQuotePermissionRefreshErrorsTotal += Math.max(0, Math.trunc(Number(count) || 0));
}

export function incWsOriginRejectedTotal() {
  metricWsOriginRejectedTotal += 1;
}

export function incWsUserConnectionLimitRejectedTotal() {
  metricWsUserConnectionLimitRejectedTotal += 1;
}

export function incWsMessageRateLimitedTotal() {
  metricWsMessageRateLimitedTotal += 1;
}

export function incLoginAttemptsFailedTotal() {
  metricLoginAttemptsFailedTotal += 1;
}

export function incLoginAttemptsSuccessTotal() {
  metricLoginAttemptsSuccessTotal += 1;
}

export function incHttpResponses403CsrfTotal() {
  metricHttpResponses403CsrfTotal += 1;
}

export function incBotChallengesIssuedTotal() {
  metricBotChallengesIssuedTotal += 1;
}

export function observeHttpRequestDuration(route: string, durationSec: number) {
  observeHttpRequestMetric({
    route,
    durationSec,
    method: "unknown",
    statusClass: "unknown",
    operation: "legacy_manual",
  });
}

export function observeHttpRequestMetric(params: {
  route: string;
  durationSec: number;
  method?: string;
  statusCode?: number;
  statusClass?: string;
  operation?: string;
  traceID?: string | null;
  spanID?: string | null;
}): void {
  const routeKey = String(params.route || "").trim();
  if (!routeKey) return;
  const duration = Number(params.durationSec);
  if (!Number.isFinite(duration) || duration < 0) return;

  const method = normalizeMetricLabelValue(params.method, "unknown");
  const statusClass =
    params.statusClass != null
      ? normalizeMetricLabelValue(params.statusClass, "unknown")
      : params.statusCode != null
        ? `${Math.max(0, Math.min(9, Math.trunc(Number(params.statusCode) / 100)))}xx`
        : "unknown";
  const operation = normalizeMetricLabelValue(params.operation, "unknown");

  let state = httpRequestDurationByRoute.get(routeKey);
  if (!state) {
    state = { buckets: new Array(HTTP_REQUEST_DURATION_BUCKETS_SEC.length).fill(0), sum: 0, count: 0 };
    httpRequestDurationByRoute.set(routeKey, state);
  }

  state.count += 1;
  state.sum += duration;
  for (let i = 0; i < HTTP_REQUEST_DURATION_BUCKETS_SEC.length; i++) {
    if (duration <= HTTP_REQUEST_DURATION_BUCKETS_SEC[i]) {
      state.buckets[i] += 1;
    }
  }

  httpRequestDurationHistogram.observe(
    {
      service: SERVICE_LABEL,
      method,
      route: routeKey,
      status_class: statusClass,
      operation,
    },
    duration,
    params.traceID
      ? {
          traceID: params.traceID,
          spanID: String(params.spanID ?? ""),
          value: duration,
          timestampMs: Date.now(),
        }
      : null,
  );
  httpRequestsTotal.inc({
    service: SERVICE_LABEL,
    method,
    route: routeKey,
    status_class: statusClass,
    operation,
  });
  if (statusClass === "4xx" || statusClass === "5xx") {
    httpRequestErrorsTotal.inc({
      service: SERVICE_LABEL,
      method,
      route: routeKey,
      status_class: statusClass,
      operation,
    });
  }
}

export function changeHttpRequestsInFlight(params: {
  method?: string;
  route: string;
  operation?: string;
  delta: number;
}): void {
  const route = normalizeRouteLabelValue(params.route);
  const method = normalizeMetricLabelValue(params.method, "unknown");
  const operation = normalizeMetricLabelValue(params.operation, "unknown");
  httpRequestsInFlight.inc(
    {
      service: SERVICE_LABEL,
      method,
      route,
      operation,
    },
    Number(params.delta) || 0,
  );
}

export function observeBusinessFlowStep(params: {
  flow: string;
  step: string;
  outcome: "success" | "failure" | "attempt" | "blocked";
  durationSec?: number;
  traceID?: string | null;
  spanID?: string | null;
}): void {
  const flow = normalizeMetricLabelValue(params.flow);
  const step = normalizeMetricLabelValue(params.step);
  const outcome = normalizeMetricLabelValue(params.outcome);
  businessFlowStepsTotal.inc({
    service: SERVICE_LABEL,
    flow,
    step,
    outcome,
  });
  if (Number.isFinite(params.durationSec) && Number(params.durationSec) >= 0) {
    businessFlowStepDurationSeconds.observe(
      {
        service: SERVICE_LABEL,
        flow,
        step,
        outcome,
      },
      Number(params.durationSec),
      params.traceID
        ? {
            traceID: params.traceID,
            spanID: String(params.spanID ?? ""),
            value: Number(params.durationSec),
            timestampMs: Date.now(),
          }
        : null,
    );
  }
}

export function incOperationFailure(operation: string, reason: string): void {
  operationFailuresTotal.inc({
    service: SERVICE_LABEL,
    operation: normalizeMetricLabelValue(operation),
    reason: normalizeMetricLabelValue(reason),
  });
}

export function changeBackgroundJobRunning(job: string, delta: number): void {
  backgroundJobRunning.inc(
    {
      service: SERVICE_LABEL,
      job: normalizeMetricLabelValue(job),
    },
    Number(delta) || 0,
  );
}

export function observeBackgroundJobRun(params: {
  job: string;
  outcome: "success" | "failure" | "canceled";
  durationSec: number;
  traceID?: string | null;
  spanID?: string | null;
}): void {
  const outcome = normalizeMetricLabelValue(params.outcome);
  const job = normalizeMetricLabelValue(params.job);
  backgroundJobRunsTotal.inc({
    service: SERVICE_LABEL,
    job,
    outcome,
  });
  backgroundJobDurationSeconds.observe(
    {
      service: SERVICE_LABEL,
      job,
      outcome,
    },
    Number(params.durationSec) || 0,
    params.traceID
      ? {
          traceID: params.traceID,
          spanID: String(params.spanID ?? ""),
          value: Number(params.durationSec) || 0,
          timestampMs: Date.now(),
        }
      : null,
  );
}

export function getHttpRequestDurationHistogramSnapshot(): {
  bucketsSec: number[];
  series: Array<{ route: string; buckets: number[]; sum: number; count: number }>;
} {
  const series: Array<{ route: string; buckets: number[]; sum: number; count: number }> = [];
  for (const [route, state] of httpRequestDurationByRoute.entries()) {
    series.push({
      route,
      buckets: [...state.buckets],
      sum: state.sum,
      count: state.count,
    });
  }
  return {
    bucketsSec: [...HTTP_REQUEST_DURATION_BUCKETS_SEC],
    series,
  };
}

export function getRouteMetricSnapshot() {
  return {
    metricTradeCloseRejectedQuoteStaleTotal,
    metricTradeTargetsRejectedQuoteStaleTotal,
    metricTradeOpenRejectedQuoteRevalidationTotal,
    metricTradeCloseRejectedQuoteRevalidationTotal,
    metricWsQuotePermissionRefreshTotal,
    metricWsQuotePermissionRefreshErrorsTotal,
    metricWsOriginRejectedTotal,
    metricWsUserConnectionLimitRejectedTotal,
    metricWsMessageRateLimitedTotal,
    metricLoginAttemptsFailedTotal,
    metricLoginAttemptsSuccessTotal,
    metricHttpResponses403CsrfTotal,
    metricBotChallengesIssuedTotal,
  };
}

export function renderObservabilityMetricLines(): string[] {
  return [
    ...httpRequestDurationHistogram.render(),
    ...httpRequestsTotal.render(),
    ...httpRequestErrorsTotal.render(),
    ...httpRequestsInFlight.render(),
    ...businessFlowStepsTotal.render(),
    ...businessFlowStepDurationSeconds.render(),
    ...operationFailuresTotal.render(),
    ...backgroundJobRunsTotal.render(),
    ...backgroundJobDurationSeconds.render(),
    ...backgroundJobRunning.render(),
  ];
}

export function metricsContentType(): string {
  return "application/openmetrics-text; version=1.0.0; charset=utf-8";
}
