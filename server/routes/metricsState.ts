let metricTradeCloseRejectedQuoteStaleTotal = 0;
let metricTradeTargetsRejectedQuoteStaleTotal = 0;
let metricWsQuotePermissionRefreshTotal = 0;
let metricWsQuotePermissionRefreshErrorsTotal = 0;
let metricWsOriginRejectedTotal = 0;
let metricWsUserConnectionLimitRejectedTotal = 0;
let metricWsMessageRateLimitedTotal = 0;

export function incTradeCloseRejectedQuoteStaleTotal() {
  metricTradeCloseRejectedQuoteStaleTotal += 1;
}

export function incTradeTargetsRejectedQuoteStaleTotal() {
  metricTradeTargetsRejectedQuoteStaleTotal += 1;
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

export function getRouteMetricSnapshot() {
  return {
    metricTradeCloseRejectedQuoteStaleTotal,
    metricTradeTargetsRejectedQuoteStaleTotal,
    metricWsQuotePermissionRefreshTotal,
    metricWsQuotePermissionRefreshErrorsTotal,
    metricWsOriginRejectedTotal,
    metricWsUserConnectionLimitRejectedTotal,
    metricWsMessageRateLimitedTotal,
  };
}
