type ExportCreatePayload = {
  type:
    | "users"
    | "user_timeline"
    | "all_trades"
    | "daily_pnl"
    | "trader_scouting"
    | "deactivated_accounts"
    | "trade_audit"
    | "order_intent_audit";
  format: "csv" | "jsonl" | "parquet";
  filters: Record<string, unknown>;
};

type CreatedJob = {
  jobId: string;
  payload: ExportCreatePayload;
  createLatencyMs: number;
};

type PolledJob = {
  id: string;
  status: string;
  error: string | null;
  rowCount: number | null;
  bytesWritten: number | null;
};

type CsrfSession = {
  csrfToken: string;
  cookie: string;
};

function mergeCookieHeader(existingCookie: string, setCookiePairs: string[]): string {
  const jar = new Map<string, string>();

  for (const part of existingCookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) continue;
    jar.set(key, value);
  }

  for (const pair of setCookiePairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) continue;
    jar.set(key, value);
  }

  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function parseSetCookiePairs(headers: Headers): string[] {
  const getter = (headers as any).getSetCookie;
  if (typeof getter === "function") {
    const values = getter.call(headers) as string[];
    return values
      .map((raw) => raw.split(";")[0]?.trim() || "")
      .filter(Boolean);
  }

  const raw = headers.get("set-cookie") || "";
  if (!raw) return [];
  const pairPattern = /(?:^|,\s*)([^=,\s;]+=[^;,\s]+)/g;
  const out: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = pairPattern.exec(raw))) {
    const pair = String(match[1] || "").trim();
    if (pair) out.push(pair);
  }
  return out;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

async function fetchCsrfToken(baseUrl: string, cookie: string): Promise<CsrfSession> {
  const res = await fetch(`${baseUrl}/api/csrf`, {
    method: "GET",
    headers: {
      cookie,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`csrf fetch failed status=${res.status}`);
  }
  const body = (await res.json()) as { csrfToken?: string };
  const token = String(body?.csrfToken || "");
  if (!token) throw new Error("csrf token missing");
  const setCookiePairs = parseSetCookiePairs(res.headers);
  return {
    csrfToken: token,
    cookie: mergeCookieHeader(cookie, setCookiePairs),
  };
}

function defaultPayloads(): ExportCreatePayload[] {
  return [
    {
      type: "users",
      format: "parquet",
      filters: { limit: 50_000, includeAdmins: true, includeDeleted: true },
    },
    {
      type: "user_timeline",
      format: "parquet",
      filters: { userId: 1, limit: 100_000 },
    },
    { type: "all_trades", format: "csv", filters: { limit: 25_000 } },
    { type: "daily_pnl", format: "csv", filters: { limitDays: 365 } },
    {
      type: "trader_scouting",
      format: "csv",
      filters: { days: 30, exportLimit: 20_000, minTrades: 10 },
    },
    { type: "deactivated_accounts", format: "csv", filters: { days: 90, includeTrades: true } },
    { type: "trade_audit", format: "csv", filters: { limit: 20_000 } },
    { type: "order_intent_audit", format: "csv", filters: { limit: 20_000 } },
  ];
}

async function createExportJob(params: {
  baseUrl: string;
  cookie: string;
  csrfToken: string;
  payload: ExportCreatePayload;
}): Promise<CreatedJob> {
  const started = Date.now();
  const res = await fetch(`${params.baseUrl}/api/admin/data-exports`, {
    method: "POST",
    headers: {
      cookie: params.cookie,
      "content-type": "application/json",
      "x-csrf-token": params.csrfToken,
      accept: "application/json",
    },
    body: JSON.stringify(params.payload),
  });
  const createLatencyMs = Date.now() - started;
  const body = (await res.json().catch(() => ({}))) as { jobId?: string; message?: string };
  if (!res.ok || !body?.jobId) {
    throw new Error(
      `create export failed status=${res.status} type=${params.payload.type} message=${body?.message || "unknown"}`,
    );
  }
  return {
    jobId: body.jobId,
    payload: params.payload,
    createLatencyMs,
  };
}

async function pollJob(params: {
  baseUrl: string;
  cookie: string;
  jobId: string;
}): Promise<PolledJob> {
  const res = await fetch(`${params.baseUrl}/api/admin/data-exports/${encodeURIComponent(params.jobId)}`, {
    method: "GET",
    headers: {
      cookie: params.cookie,
      accept: "application/json",
    },
  });
  const body = (await res.json().catch(() => ({}))) as { job?: any; message?: string };
  if (!res.ok || !body?.job) {
    throw new Error(`poll failed jobId=${params.jobId} status=${res.status} message=${body?.message || "unknown"}`);
  }
  const j = body.job;
  return {
    id: String(j.id),
    status: String(j.status || "UNKNOWN"),
    error: j.error == null ? null : String(j.error),
    rowCount: j.rowCount == null ? null : Number(j.rowCount),
    bytesWritten: j.bytesWritten == null ? null : Number(j.bytesWritten),
  };
}

async function requestDownloadLink(params: {
  baseUrl: string;
  cookie: string;
  jobId: string;
}): Promise<void> {
  const res = await fetch(
    `${params.baseUrl}/api/admin/data-exports/${encodeURIComponent(params.jobId)}/download-link`,
    {
      method: "GET",
      headers: {
        cookie: params.cookie,
        accept: "application/json",
      },
    },
  );
  const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
  if (!res.ok || !body?.url) {
    throw new Error(
      `download-link failed jobId=${params.jobId} status=${res.status} message=${body?.message || "unknown"}`,
    );
  }
}

async function main() {
  const baseUrl = String(process.env.LOADTEST_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
  const cookie = String(process.env.LOADTEST_ADMIN_COOKIE || "").trim();
  const pollIntervalMs = envInt("LOADTEST_EXPORT_POLL_INTERVAL_MS", 3000, 500, 60_000);
  const maxWaitSec = envInt("LOADTEST_EXPORT_MAX_WAIT_SEC", 240, 10, 3600);
  const jobCount = envInt("LOADTEST_EXPORT_JOB_COUNT", 6, 1, 200);

  if (!cookie) {
    console.error(
      "[exportPipeline] missing LOADTEST_ADMIN_COOKIE. This loadtest requires an authenticated admin session cookie.",
    );
    process.exitCode = 2;
    return;
  }

  console.log(
    `[exportPipeline] baseUrl=${baseUrl} jobCount=${jobCount} pollIntervalMs=${pollIntervalMs} maxWaitSec=${maxWaitSec}`,
  );

  const csrf = await fetchCsrfToken(baseUrl, cookie);
  const authCookie = csrf.cookie;
  const templates = defaultPayloads();
  const createdJobs: CreatedJob[] = [];

  for (let i = 0; i < jobCount; i += 1) {
    const payload = templates[i % templates.length]!;
    const created = await createExportJob({
      baseUrl,
      cookie: authCookie,
      csrfToken: csrf.csrfToken,
      payload,
    });
    createdJobs.push(created);
    console.log(
      `[exportPipeline] created jobId=${created.jobId} type=${created.payload.type} latencyMs=${created.createLatencyMs}`,
    );
  }

  const deadlineMs = Date.now() + maxWaitSec * 1000;
  const lastStateByJob = new Map<string, PolledJob>();
  const unfinished = new Set(createdJobs.map((j) => j.jobId));
  const terminal = new Set(["READY", "FAILED", "CANCELED", "EXPIRED"]);

  while (unfinished.size > 0 && Date.now() < deadlineMs) {
    for (const jobId of Array.from(unfinished)) {
      const state = await pollJob({ baseUrl, cookie: authCookie, jobId });
      lastStateByJob.set(jobId, state);
      if (terminal.has(state.status)) {
        unfinished.delete(jobId);
      }
    }
    if (unfinished.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  if (unfinished.size > 0) {
    console.error(`[exportPipeline] timeout waiting for jobs: ${Array.from(unfinished).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  let ready = 0;
  let failed = 0;
  let canceled = 0;
  let expired = 0;
  let downloaded = 0;

  for (const job of createdJobs) {
    const state = lastStateByJob.get(job.jobId);
    if (!state) continue;
    if (state.status === "READY") {
      ready += 1;
      await requestDownloadLink({ baseUrl, cookie: authCookie, jobId: job.jobId });
      downloaded += 1;
    } else if (state.status === "FAILED") {
      failed += 1;
    } else if (state.status === "CANCELED") {
      canceled += 1;
    } else if (state.status === "EXPIRED") {
      expired += 1;
    }
    console.log(
      `[exportPipeline] jobId=${job.jobId} status=${state.status} rows=${state.rowCount ?? "na"} bytes=${state.bytesWritten ?? "na"} error=${state.error ?? "none"}`,
    );
  }

  console.log(
    `[exportPipeline] done total=${createdJobs.length} ready=${ready} failed=${failed} canceled=${canceled} expired=${expired} downloadLinksOk=${downloaded}`,
  );

  if (failed > 0 || canceled > 0) {
    console.error("[exportPipeline] assertion failed: terminal status includes FAILED/CANCELED");
    process.exitCode = 1;
    return;
  }
  if (ready === 0) {
    console.error("[exportPipeline] assertion failed: no READY exports");
    process.exitCode = 1;
    return;
  }

  console.log("[exportPipeline] assertions passed");
}

main().catch((err) => {
  console.error("[exportPipeline] fatal:", err);
  process.exit(1);
});
