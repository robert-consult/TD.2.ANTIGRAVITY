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

type HttpRequestDurationState = {
  buckets: number[];
  sum: number;
  count: number;
};

const httpRequestDurationByRoute = new Map<string, HttpRequestDurationState>();

export function incTradeCloseRejectedQuoteStaleTotal() {
  metricTradeCloseRejectedQuoteStaleTotal += 1;
}

export function incTradeTargetsRejectedQuoteStaleTotal() {
  metricTradeTargetsRejectedQuoteStaleTotal += 1;
}

export function incTradeOpenRejectedQuoteRevalidationTotal() {
  metricTradeOpenRejectedQuoteRevalidationTotal += 1;
}

export function incTradeCloseRejectedQuoteRevalidationTotal() {
  metricTradeCloseRejectedQuoteRevalidationTotal += 1;
}

export function addWsQuotePermissionRefreshTotal(count: number) {
  metricWsQuotePermissionRefreshTotal += count;
}

export function addWsQuotePermissionRefreshErrorsTotal(count: number) {
  metricWsQuotePermissionRefreshErrorsTotal += count;
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
  const routeKey = String(route || "").trim();
  if (!routeKey) return;
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration < 0) return;

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
