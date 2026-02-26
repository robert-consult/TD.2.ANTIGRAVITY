type RequestStat = {
  endpoint: string;
  status: number;
  latencyMs: number;
  cacheState: string;
};

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] || 0;
}

async function main() {
  const baseUrl = String(process.env.LOADTEST_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
  const durationSec = envInt("LOADTEST_DURATION_SEC", 45, 5, 1800);
  const concurrency = envInt("LOADTEST_CONCURRENCY", 6, 1, 128);
  const timeoutMs = envInt("LOADTEST_TIMEOUT_MS", 10_000, 500, 120_000);
  const maxP95Ms = envInt("LOADTEST_MAX_P95_MS", 1200, 100, 60_000);
  const maxErrorPct = Number(process.env.LOADTEST_MAX_ERROR_PCT ?? 1.0);
  const cookie = String(process.env.LOADTEST_ADMIN_COOKIE || "").trim();
  const dayWindowsRaw = String(process.env.LOADTEST_DAY_WINDOWS || "7,30,90");
  const dayWindows = Array.from(
    new Set(
      dayWindowsRaw
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v))
        .map((v) => Math.max(0, Math.min(365, Math.trunc(v)))),
    ),
  );

  if (!cookie) {
    console.error(
      "[adminDataTab] missing LOADTEST_ADMIN_COOKIE. This loadtest requires an authenticated admin session cookie.",
    );
    process.exitCode = 2;
    return;
  }

  const endpoints = dayWindows.flatMap((d) => [
    `/api/admin/kpi-summary?days=${d}`,
    `/api/admin/signup-funnel?days=${d}`,
    `/api/admin/user-analytics?days=${d}`,
    `/api/admin/deactivated-accounts/summary?days=${d}`,
  ]);
  endpoints.push("/api/admin/analytics/compliance");

  const stats: RequestStat[] = [];
  const startedAt = Date.now();
  const runUntil = startedAt + durationSec * 1000;
  let cursor = 0;

  const runWorker = async () => {
    while (Date.now() < runUntil) {
      const endpoint = endpoints[cursor % endpoints.length]!;
      cursor += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const requestStarted = Date.now();
      try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: "GET",
          headers: {
            cookie,
            accept: "application/json",
          },
          signal: controller.signal,
        });
        const latencyMs = Date.now() - requestStarted;
        stats.push({
          endpoint,
          status: response.status,
          latencyMs,
          cacheState: response.headers.get("x-admin-rollup-cache-state") || "na",
        });
        await response.arrayBuffer().catch(() => {});
      } catch {
        const latencyMs = Date.now() - requestStarted;
        stats.push({
          endpoint,
          status: 0,
          latencyMs,
          cacheState: "error",
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  };

  console.log(
    `[adminDataTab] baseUrl=${baseUrl} durationSec=${durationSec} concurrency=${concurrency} windows=${dayWindows.join(",")}`,
  );

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

  const elapsedMs = Date.now() - startedAt;
  const total = stats.length;
  const failures = stats.filter((s) => s.status < 200 || s.status >= 300).length;
  const errorPct = total > 0 ? (failures / total) * 100 : 100;
  const latencies = stats.map((s) => s.latencyMs).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const rps = total > 0 ? total / (elapsedMs / 1000) : 0;
  const cacheStates = stats.reduce<Record<string, number>>((acc, s) => {
    acc[s.cacheState] = (acc[s.cacheState] || 0) + 1;
    return acc;
  }, {});

  console.log(`[adminDataTab] done requests=${total} failures=${failures} errorPct=${errorPct.toFixed(2)}% rps=${rps.toFixed(1)}`);
  console.log(`[adminDataTab] latency p50=${p50}ms p95=${p95}ms p99=${p99}ms`);
  console.log(`[adminDataTab] cacheStates=${JSON.stringify(cacheStates)}`);

  const failuresByEndpoint = stats.reduce<Record<string, number>>((acc, s) => {
    if (s.status >= 200 && s.status < 300) return acc;
    acc[s.endpoint] = (acc[s.endpoint] || 0) + 1;
    return acc;
  }, {});
  if (Object.keys(failuresByEndpoint).length > 0) {
    console.log(`[adminDataTab] non2xxByEndpoint=${JSON.stringify(failuresByEndpoint)}`);
  }

  if (errorPct > maxErrorPct) {
    console.error(`[adminDataTab] assertion failed: errorPct=${errorPct.toFixed(2)} > ${maxErrorPct}`);
    process.exitCode = 1;
    return;
  }
  if (p95 > maxP95Ms) {
    console.error(`[adminDataTab] assertion failed: p95=${p95}ms > ${maxP95Ms}ms`);
    process.exitCode = 1;
    return;
  }

  console.log("[adminDataTab] assertions passed");
}

main().catch((err) => {
  console.error("[adminDataTab] fatal:", err);
  process.exit(1);
});
