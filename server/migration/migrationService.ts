// @ts-nocheck
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { once } from "events";
import readline from "readline";
import { db, dbClient } from "@db";
import { storage } from "../storage";
import {
  migrationExportJobs,
  migrationImportJobs,
  migrationJobLogs,
  migrationIntegrityChecks,
  systemConfig,
} from "@shared/schema";
import { desc, eq } from "drizzle-orm";

type ExportScope = "FULL_PLATFORM" | "USER_BUNDLE" | "DELTA";
type ExportStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED";
type ImportMode = "DRY_RUN" | "IMPORT";
type ImportStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
type IdStrategy = "PRESERVE";

const EXPORT_DIR = path.join(process.cwd(), "migration_exports");
const IMPORT_DIR = path.join(process.cwd(), "migration_imports");
const MAX_LOG_CONTEXT = 20_000;
const BATCH_SIZE = 1000;
const YIELD_EVERY = 2000;

function convertQuestionMarks(sql: string): string {
  let out = "";
  let index = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLineComment) {
      out += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === "-" && next === "-") {
        out += ch + next;
        i++;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        out += ch + next;
        i++;
        inBlockComment = true;
        continue;
      }
    }

    if (ch === "'" && !inDouble) {
      out += ch;
      if (inSingle && next === "'") {
        out += next;
        i++;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (ch === "\"" && !inSingle) {
      out += ch;
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && ch === "?") {
      out += `$${index++}`;
      continue;
    }

    out += ch;
  }

  return out;
}

async function queryAll<T = any>(sql: string, args: any[] = []): Promise<T[]> {
  const text = convertQuestionMarks(sql);
  const result = await dbClient.query(text, args);
  return result.rows as T[];
}

async function queryOne<T = any>(sql: string, args: any[] = []): Promise<T | undefined> {
  const rows = await queryAll<T>(sql, args);
  return rows[0];
}

const EXCLUDED_TABLES = new Set<string>([
  "__drizzle_migrations",
  "migration_export_jobs",
  "migration_import_jobs",
  "migration_job_logs",
  "migration_id_map",
  "migration_integrity_checks",
]);

const TABLE_ORDER = [
  "users",
  "user_settings",
  "user_verification",
  "user_mfa",
  "user_kyc_profiles",
  "user_payout_profiles",
  "user_sessions",
  "user_login_history",
  "user_account_events",
  "user_admin_notes",
  "trader_journal",
  "user_equity_daily",
  "email_verification_tokens",
  "sms_otp_tokens",
  "signup_fingerprints",
  "symbol_configs",
  "trader_quote_prefs",
  "trader_quote_subscriptions",
  "quote_subscription_config",
  "global_settings",
  "system_config",
  "trades",
  "trade_audit",
  "order_intent_audit",
  "daily_fx_closes",
  "daily_closes",
  "daily_prices",
  "price_history",
  "price_references",
  "reference_prices",
  "market_daily_close",
  "prev_close_cache",
  "quotes",
  "admin_actions",
  "identity_audit",
  "legal_documents",
  "legal_doc_targets",
  "legal_doc_pointers",
  "legal_doc_change_audit",
  "legal_doc_change_audit_chain",
  "legal_acceptances",
  "legal_reaccept_requirements",
  "grift_config",
  "grift_devices",
  "grift_device_users",
  "grift_identity_links",
  "grift_user_scores",
  "grift_user_risk",
  "grift_signals",
  "grift_observations",
  "grift_alerts",
  "grift_cases",
  "grift_case_signals",
  "grift_case_notes",
  "grift_case_links",
  "grift_user_enforcements",
  "grift_enforcement_log",
  "grift_admin_actions",
  "grift_ip_asn_dataset_meta",
  "grift_ip_asn_ranges",
  "grift_ip_asn_cache",
  "grift_trade_observations",
  "grift_linked_account_edges",
];

const USER_BUNDLE_ALWAYS = new Set<string>([
  "users",
  "symbol_configs",
  "user_settings",
  "user_verification",
  "user_mfa",
  "user_kyc_profiles",
  "user_payout_profiles",
  "user_sessions",
  "user_login_history",
  "user_account_events",
  "user_admin_notes",
  "trader_journal",
  "user_equity_daily",
  "email_verification_tokens",
  "sms_otp_tokens",
  "signup_fingerprints",
  "trader_quote_prefs",
  "trader_quote_subscriptions",
  "quote_subscription_config",
  "trades",
  "trade_audit",
  "order_intent_audit",
  "admin_actions",
  "identity_audit",
  "legal_acceptances",
  "legal_reaccept_requirements",
  "grift_user_risk",
  "grift_user_scores",
  "grift_alerts",
  "grift_user_enforcements",
  "grift_enforcement_log",
]);

const TIME_COLUMN_PRIORITY: Array<{ name: string; unit: "ms" | "s" }> = [
  { name: "event_at_ms", unit: "ms" },
  { name: "created_at_ms", unit: "ms" },
  { name: "accepted_at_ms", unit: "ms" },
  { name: "updated_at_ms", unit: "ms" },
  { name: "ts", unit: "ms" },
  { name: "event_at", unit: "s" },
  { name: "created_at", unit: "s" },
  { name: "updated_at", unit: "s" },
  { name: "accepted_at", unit: "s" },
  { name: "opened_at", unit: "s" },
  { name: "closed_at", unit: "s" },
  { name: "calculated_at", unit: "s" },
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function makeJobId(prefix: string): string {
  return `${prefix}-${nowMs()}-${crypto.randomBytes(4).toString("hex")}`;
}

function safeJson(value: any) {
  const raw = JSON.stringify(value ?? {});
  return raw.length > MAX_LOG_CONTEXT ? raw.slice(0, MAX_LOG_CONTEXT) : raw;
}

async function logJob(jobId: string, level: "INFO" | "WARN" | "ERROR", message: string, context?: any) {
  await db.insert(migrationJobLogs).values({
    jobId,
    ts: nowMs(),
    level,
    message,
    contextJson: safeJson(context),
  }).run();
}

async function listTables(): Promise<string[]> {
  const rows = await queryAll<{ name: string }>(
    "SELECT tablename as name FROM pg_tables WHERE schemaname = 'public'"
  );
  return rows.map((r) => r.name).filter((name) => !EXCLUDED_TABLES.has(name));
}

async function tableExists(table: string): Promise<boolean> {
  const row = await queryOne<{ regclass: string | null }>("SELECT to_regclass(?) as regclass", [`public.${table}`]);
  return Boolean(row?.regclass);
}

function orderTables(tables: string[]): string[] {
  const set = new Set(tables);
  const ordered: string[] = [];
  for (const name of TABLE_ORDER) {
    if (set.has(name)) {
      ordered.push(name);
      set.delete(name);
    }
  }
  const remaining = Array.from(set).sort();
  return ordered.concat(remaining);
}

async function getTableColumns(table: string): Promise<string[]> {
  const rows = await queryAll<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ?
    ORDER BY ordinal_position
  `,
    [table]
  );
  return rows.map((r) => r.column_name);
}

async function getPrimaryKeys(table: string): Promise<string[]> {
  const rows = await queryAll<{ column_name: string; ordinal_position: number }>(
    `
    SELECT kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = ?
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
  `,
    [table]
  );
  return rows.map((r) => r.column_name);
}

function findTimeColumn(columns: string[]): { column: string; unit: "ms" | "s" } | null {
  for (const option of TIME_COLUMN_PRIORITY) {
    if (columns.includes(option.name)) return { column: option.name, unit: option.unit };
  }
  return null;
}

function buildSelectSql(params: {
  scope: ExportScope;
  table: string;
  columns: string[];
  userId?: number;
  sinceTs?: number;
}): { sql: string; args: any[]; timeColumn?: string } | null {
  const { scope, table, columns, userId, sinceTs } = params;

  if (scope === "FULL_PLATFORM") {
    return { sql: `SELECT * FROM "${table}"`, args: [] };
  }

  if (scope === "USER_BUNDLE") {
    if (!userId) throw new Error("USER_BUNDLE requires userId");
    if (table === "users") {
      return { sql: `SELECT * FROM users WHERE id = ?`, args: [userId] };
    }
    if (table === "symbol_configs") {
      return { sql: `SELECT * FROM symbol_configs`, args: [] };
    }
    if (table === "trade_audit") {
      return {
        sql: `SELECT ta.* FROM trade_audit ta JOIN trades t ON t.id = ta.trade_id WHERE t.user_id = ?`,
        args: [userId],
      };
    }
    if (table === "trades") {
      return { sql: `SELECT * FROM trades WHERE user_id = ?`, args: [userId] };
    }
    if (columns.includes("user_id")) {
      return { sql: `SELECT * FROM "${table}" WHERE user_id = ?`, args: [userId] };
    }
    if (columns.includes("target_user_id")) {
      return { sql: `SELECT * FROM "${table}" WHERE target_user_id = ?`, args: [userId] };
    }
    if (USER_BUNDLE_ALWAYS.has(table)) {
      return { sql: `SELECT * FROM "${table}"`, args: [] };
    }
    return null;
  }

  if (scope === "DELTA") {
    if (!sinceTs) throw new Error("DELTA requires sinceTs");
    const timeColumn = findTimeColumn(columns);
    if (!timeColumn) return null;
    const sinceValue = timeColumn.unit === "ms" ? sinceTs : Math.floor(sinceTs / 1000);
    return {
      sql: `SELECT * FROM "${table}" WHERE ${timeColumn.column} >= ?`,
      args: [sinceValue],
      timeColumn: timeColumn.column,
    };
  }

  return { sql: `SELECT * FROM "${table}"`, args: [] };
}

async function writeLine(ws: fs.WriteStream, line: string) {
  if (!ws.write(line)) {
    await once(ws, "drain");
  }
}

async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function computeChunkChain(filePaths: string[]) {
  const dataHash = crypto.createHash("sha256");
  const sha256Hex = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
  const chunks: Array<{
    index: number;
    path: string;
    sizeBytes: number;
    sha256: string;
    prevSha256: string | null;
    linkHash: string;
  }> = [];

  let prevLinkHash = "GENESIS";
  let prevSha256: string | null = null;

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const partHash = crypto.createHash("sha256");
    let sizeBytes = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => {
        sizeBytes += chunk.length;
        dataHash.update(chunk);
        partHash.update(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });

    const sha256 = partHash.digest("hex");
    const linkHash = sha256Hex(`${prevLinkHash}:${sha256}`);
    chunks.push({ index: i, path: filePath, sizeBytes, sha256, prevSha256, linkHash });
    prevSha256 = sha256;
    prevLinkHash = linkHash;
  }

  return { dataSha256: dataHash.digest("hex"), chunks, headLinkHash: prevLinkHash };
}

export async function getExportJob(jobId: string) {
  const rows = await db.select().from(migrationExportJobs).where(eq(migrationExportJobs.id, jobId)).limit(1);
  return rows[0];
}

export async function listExportJobs(limit = 50) {
  return await db.select().from(migrationExportJobs).orderBy(desc(migrationExportJobs.createdAt)).limit(limit);
}

export async function getImportJob(jobId: string) {
  const rows = await db.select().from(migrationImportJobs).where(eq(migrationImportJobs.id, jobId)).limit(1);
  return rows[0];
}

export async function listImportJobs(limit = 50) {
  return await db.select().from(migrationImportJobs).orderBy(desc(migrationImportJobs.createdAt)).limit(limit);
}

export async function listJobLogs(jobId: string, limit = 200) {
  return await db
    .select()
    .from(migrationJobLogs)
    .where(eq(migrationJobLogs.jobId, jobId))
    .orderBy(desc(migrationJobLogs.ts))
    .limit(limit);
}

export async function createExportJob(params: {
  scope: ExportScope;
  userId?: number;
  sinceTs?: number;
  requestedByAdminId?: number | null;
}): Promise<{ jobId: string }> {
  const jobId = makeJobId("MIGEXP");
  const createdAt = nowMs();

  await db.insert(migrationExportJobs).values({
    id: jobId,
    scope: params.scope,
    userId: params.userId ?? null,
    sinceTs: params.sinceTs ?? null,
    requestedByAdminId: params.requestedByAdminId ?? null,
    status: "QUEUED",
    createdAt,
    totalsJson: "{}",
    manifestJson: "{}",
  }).run();

  await logJob(jobId, "INFO", "Export job queued", params);

  setImmediate(() => {
    runExportJob(jobId, params).catch((err) => {
      console.error("[migration] export job failed:", err);
    });
  });

  return { jobId };
}

async function runExportJob(
  jobId: string,
  params: { scope: ExportScope; userId?: number; sinceTs?: number; requestedByAdminId?: number | null }
) {
  const startedAt = nowMs();
  await db
    .update(migrationExportJobs)
    .set({ status: "RUNNING", startedAt })
    .where(eq(migrationExportJobs.id, jobId))
    .run();
  await logJob(jobId, "INFO", "Export job started");

  ensureDir(EXPORT_DIR);

  const cfg = await db.query.systemConfig.findFirst({
    where: eq(systemConfig.id, 1),
  });
  const chunkingEnabled = Boolean((cfg as any)?.migrationChunkingEnabled ?? false);
  const chunkSizeMbRaw = Number((cfg as any)?.migrationChunkSizeMb ?? 51200);
  const chunkSizeMb = Number.isFinite(chunkSizeMbRaw) && chunkSizeMbRaw > 0 ? Math.floor(chunkSizeMbRaw) : 51200;
  const chunkSizeBytes = chunkSizeMb * 1024 * 1024;
  const useChunking = chunkingEnabled && Number.isFinite(chunkSizeBytes) && chunkSizeBytes > 0;

  const makePartBasename = (index: number) => `${jobId}.data.part${String(index).padStart(5, "0")}.ndjson`;
  const dataPath = useChunking
    ? path.join(EXPORT_DIR, makePartBasename(0))
    : path.join(EXPORT_DIR, `${jobId}.data.ndjson`);
  const manifestPath = path.join(EXPORT_DIR, `${jobId}.manifest.json`);

  let partIndex = 0;
  let partPath = dataPath;
  let ws = fs.createWriteStream(partPath, { encoding: "utf8" });
  let partHash = crypto.createHash("sha256");
  let partRows = 0;

  const dataHash = crypto.createHash("sha256");
  const partPaths: string[] = [partPath];
  const chunks: any[] = [];
  let prevSha256: string | null = null;
  let prevLinkHash = "GENESIS";
  let totalSizeBytes = 0;

  const tableList = orderTables(await listTables());
  const counts: Record<string, number> = {};
  const skippedTables: string[] = [];
  let totalRows = 0;
  let yielded = 0;

  const closeStream = async (stream: fs.WriteStream) => {
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      stream.end(() => resolve());
    });
  };

  const sha256Hex = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

  const finalizeChunk = async () => {
    await closeStream(ws);
    const sha256 = partHash.digest("hex");
    const stats = fs.statSync(partPath);
    const linkHash = sha256Hex(`${prevLinkHash}:${sha256}`);
    chunks.push({
      index: partIndex,
      file: path.basename(partPath),
      rows: partRows,
      sizeBytes: stats.size,
      sha256,
      prevSha256,
      linkHash,
    });
    totalSizeBytes += stats.size;
    prevSha256 = sha256;
    prevLinkHash = linkHash;
  };

  const rotateChunk = async () => {
    await finalizeChunk();
    partIndex += 1;
    partPath = path.join(EXPORT_DIR, makePartBasename(partIndex));
    partPaths.push(partPath);
    ws = fs.createWriteStream(partPath, { encoding: "utf8" });
    partHash = crypto.createHash("sha256");
    partRows = 0;
  };

  try {
    for (const table of tableList) {
      const columns = await getTableColumns(table);
      const query = buildSelectSql({
        scope: params.scope,
        table,
        columns,
        userId: params.userId,
        sinceTs: params.sinceTs,
      });
      if (!query) {
        skippedTables.push(table);
        continue;
      }

      const rows = await queryAll<Record<string, any>>(query.sql, query.args);
      for (const row of rows) {
        const payload = JSON.stringify({ t: table, op: "upsert", row });
        const line = `${payload}\n`;
        if (useChunking && partRows > 0 && Buffer.byteLength(line, "utf8") + ws.bytesWritten > chunkSizeBytes) {
          await rotateChunk();
        }
        await writeLine(ws, line);
        dataHash.update(line);
        partHash.update(line);
        partRows += 1;
        counts[table] = (counts[table] || 0) + 1;
        totalRows += 1;
        yielded += 1;
        if (yielded % YIELD_EVERY === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }

    await finalizeChunk();

    const dataSha256 = dataHash.digest("hex");

    const manifest = {
      version: 1,
      jobId,
      createdAt: nowMs(),
      scope: params.scope,
      userId: params.userId ?? null,
      sinceTs: params.sinceTs ?? null,
      tables: tableList,
      skippedTables,
      totals: counts,
      dataFile: path.basename(dataPath),
      dataSizeBytes: totalSizeBytes,
      dataSha256,
      chunking: {
        enabled: useChunking,
        chunkSizeMb,
      },
      chunkChain: {
        algo: "sha256-linkhash-v1",
        genesis: "GENESIS",
        headLinkHash: prevLinkHash,
      },
      chunks: [
        {
          index: 0,
          file: path.basename(dataPath),
          sha256: dataSha256,
          rows: totalRows,
        },
      ],
    };

    manifest.chunks = chunks.length
      ? chunks
      : [
          {
            index: 0,
            file: path.basename(dataPath),
            sha256: dataSha256,
            rows: totalRows,
            sizeBytes: totalSizeBytes,
            prevSha256: null,
            linkHash: sha256Hex(`GENESIS:${dataSha256}`),
          },
        ];

    const manifestJson = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(manifestPath, manifestJson, "utf8");
    const manifestSha256 = crypto.createHash("sha256").update(manifestJson, "utf8").digest("hex");

    await db
      .update(migrationExportJobs)
      .set({
        status: "READY",
        completedAt: nowMs(),
        totalsJson: JSON.stringify(counts),
        manifestJson,
        dataPartsJson: JSON.stringify(partPaths),
        chunkingEnabled: useChunking,
        chunkSizeMb,
        manifestSha256,
        dataSha256,
        dataPath: dataPath,
        manifestPath,
      })
      .where(eq(migrationExportJobs.id, jobId))
      .run();

    await logJob(jobId, "INFO", "Export job completed", {
      totalRows,
      dataSha256,
      manifestSha256,
      tables: tableList,
      skippedTables,
    });

    if (params.requestedByAdminId) {
      try {
        await storage.logAdminAction({
          adminId: params.requestedByAdminId,
          userId: params.userId ?? 0,
          actionType: "MIGRATION_EXPORT_COMPLETE",
          metadata: {
            jobId,
            scope: params.scope,
            userId: params.userId ?? null,
            sinceTs: params.sinceTs ?? null,
            tables: tableList,
            skippedTables,
            totals: counts,
            manifestSha256,
            dataSha256,
          },
        });
      } catch (e) {
        console.warn("[migration] admin action log failed:", e);
      }
    }
  } catch (err: any) {
    await logJob(jobId, "ERROR", "Export job failed", { error: String(err?.message ?? err) });
    await db
      .update(migrationExportJobs)
      .set({ status: "FAILED", completedAt: nowMs(), error: String(err?.message ?? err) })
      .where(eq(migrationExportJobs.id, jobId))
      .run();
    if (params.requestedByAdminId) {
      try {
        await storage.logAdminAction({
          adminId: params.requestedByAdminId,
          userId: params.userId ?? 0,
          actionType: "MIGRATION_EXPORT_FAILED",
          metadata: {
            jobId,
            scope: params.scope,
            userId: params.userId ?? null,
            sinceTs: params.sinceTs ?? null,
            error: String(err?.message ?? err),
          },
        });
      } catch (e) {
        console.warn("[migration] admin action log failed:", e);
      }
    }
    throw err;
  }
}

export async function createImportJob(params: {
  mode: ImportMode;
  idStrategy?: IdStrategy;
  manifestPath: string;
  dataPath: string;
  dataPartsPaths?: string[];
  requestedByAdminId?: number | null;
}): Promise<{ jobId: string }> {
  const jobId = makeJobId("MIGIMP");
  const createdAt = nowMs();
  const idStrategy = params.idStrategy ?? "PRESERVE";
  const dataPartsPaths =
    Array.isArray(params.dataPartsPaths) && params.dataPartsPaths.length > 0
      ? params.dataPartsPaths
      : [params.dataPath];

  await db.insert(migrationImportJobs).values({
    id: jobId,
    mode: params.mode,
    idStrategy,
    requestedByAdminId: params.requestedByAdminId ?? null,
    status: "QUEUED",
    createdAt,
    dataPath: dataPartsPaths[0],
    dataPartsJson: JSON.stringify(dataPartsPaths),
    manifestPath: params.manifestPath,
    totalsJson: "{}",
  }).run();

  await logJob(jobId, "INFO", "Import job queued", { mode: params.mode, idStrategy });

  setImmediate(() => {
    runImportJob(jobId, { ...params, dataPartsPaths }).catch((err) => {
      console.error("[migration] import job failed:", err);
    });
  });

  return { jobId };
}

async function runImportJob(
  jobId: string,
  params: {
    mode: ImportMode;
    idStrategy?: IdStrategy;
    manifestPath: string;
    dataPath: string;
    dataPartsPaths?: string[];
    requestedByAdminId?: number | null;
  }
) {
  const startedAt = nowMs();
  await db
    .update(migrationImportJobs)
    .set({ status: "RUNNING", startedAt })
    .where(eq(migrationImportJobs.id, jobId))
    .run();
  await logJob(jobId, "INFO", "Import job started");

  ensureDir(IMPORT_DIR);

  if (params.idStrategy && params.idStrategy !== "PRESERVE") {
    throw new Error(`Unsupported idStrategy: ${params.idStrategy}`);
  }

  const manifestRaw = fs.readFileSync(params.manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  const manifestSha256 = crypto.createHash("sha256").update(manifestRaw, "utf8").digest("hex");
  const dataPartsPaths =
    Array.isArray(params.dataPartsPaths) && params.dataPartsPaths.length > 0 ? params.dataPartsPaths : [params.dataPath];

  const expectedChunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  const expectedHeadLinkHash = String(manifest?.chunkChain?.headLinkHash || "");

  if (dataPartsPaths.length > 1 && expectedChunks.length === 0) {
    throw new Error("Manifest missing chunk list for chunked import");
  }
  if (expectedChunks.length > 0 && expectedChunks.length !== dataPartsPaths.length) {
    throw new Error("Chunk count does not match manifest");
  }

  const sha256Hex = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
  const dataHash = crypto.createHash("sha256");
  let prevLinkHash = "GENESIS";
  let prevChunkSha256: string | null = null;
  let dataSha256 = "";

  const tableStates = new Map<string, any>();
  const skippedTables = new Set<string>();
  const counts: Record<string, number> = {};
  const client = await dbClient.connect();
  const exec = async (sql: string, args: any[] = []) => client.query(sql, args);

  const getTableState = async (table: string, row: Record<string, any>) => {
    let st = tableStates.get(table);
    if (st) return st;

    if (!await tableExists(table)) {
      if (!skippedTables.has(table)) {
        skippedTables.add(table);
        logJob(jobId, "WARN", "Table not found in target, skipping", { table }).catch(() => {});
      }
      return null;
    }

    const columns = await getTableColumns(table);
    const pkColumns = await getPrimaryKeys(table);
    const rowKeys = Object.keys(row || {});
    const insertColumns = columns.filter((c) => rowKeys.includes(c));
    const updateColumns = insertColumns.filter((c) => !pkColumns.includes(c));

    if (insertColumns.length === 0) {
      throw new Error(`No matching columns for table ${table}`);
    }

    const colList = insertColumns.map((c) => `"${c}"`).join(", ");
    const valuesList = insertColumns.map((_, idx) => `$${idx + 1}`).join(", ");
    let sql = `INSERT INTO "${table}" (${colList}) VALUES (${valuesList})`;

    if (pkColumns.length && updateColumns.length) {
      const conflictCols = pkColumns.map((c) => `"${c}"`).join(", ");
      const updateSet = updateColumns.map((c) => `"${c}"=excluded."${c}"`).join(", ");
      sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}`;
    }

    st = {
      table,
      columns,
      pkColumns,
      insertColumns,
      sql,
      buffer: [] as any[],
    };
    tableStates.set(table, st);
    return st;
  };

  const flushTable = async (st: any) => {
    if (!st.buffer.length) return;
    const rows = st.buffer.splice(0, st.buffer.length);
    for (const row of rows) {
      const values = st.insertColumns.map((col: string) => row[col] ?? null);
      await exec(st.sql, values);
    }
  };

  try {
    let transactionStarted = false;
    if (params.mode !== "DRY_RUN") {
      await exec("BEGIN");
      transactionStarted = true;
    }

    let processed = 0;
    for (let i = 0; i < dataPartsPaths.length; i++) {
      const partPath = dataPartsPaths[i];
      if (!partPath || typeof partPath !== "string" || !fs.existsSync(partPath)) {
        throw new Error(`Missing data part file at index ${i}`);
      }

      const expected = expectedChunks[i] ?? null;
      if (expected && expected.index !== undefined && expected.index !== null) {
        const expectedIndex = Number(expected.index);
        if (Number.isFinite(expectedIndex) && expectedIndex !== i) {
          throw new Error(`Manifest chunk index mismatch at ${i} (expected ${expectedIndex})`);
        }
      }

      if (expected && expected.file) {
        const expectedFile = String(expected.file || "").trim();
        if (expectedFile && expectedFile !== path.basename(partPath)) {
          throw new Error(`Chunk ${i} file name does not match manifest`);
        }
      }

      if (expected && expected.sizeBytes !== undefined && expected.sizeBytes !== null) {
        const expectedSize = Number(expected.sizeBytes);
        if (Number.isFinite(expectedSize)) {
          const actualSize = fs.statSync(partPath).size;
          if (actualSize !== expectedSize) {
            throw new Error(`Chunk ${i} size does not match manifest`);
          }
        }
      }

      const partHash = crypto.createHash("sha256");
      let partRows = 0;
      const input = fs.createReadStream(partPath);
      input.on("data", (chunk) => {
        dataHash.update(chunk);
        partHash.update(chunk);
      });
      const rl = readline.createInterface({ input, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const entry = JSON.parse(trimmed);
        const table = String(entry.t || "");
        const row = entry.row as Record<string, any>;
        if (!table || !row || typeof row !== "object") {
          await logJob(jobId, "WARN", "Skipping invalid row", { line: trimmed.slice(0, 500) });
          continue;
        }
        if (!/^[A-Za-z0-9_]+$/.test(table)) {
          await logJob(jobId, "WARN", "Skipping invalid table name", { table });
          continue;
        }

        const st = await getTableState(table, row);
        if (!st) continue;
        counts[table] = (counts[table] || 0) + 1;
        partRows += 1;

        processed += 1;
        if (processed % YIELD_EVERY === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }

        if (params.mode === "DRY_RUN") {
          continue;
        }

        st.buffer.push(row);
        if (st.buffer.length >= BATCH_SIZE) {
          await flushTable(st);
        }
      }

      const partSha256 = partHash.digest("hex");
      if (expected?.sha256 && String(expected.sha256) !== partSha256) {
        throw new Error(`Chunk ${i} SHA-256 does not match manifest`);
      }
      if (expected?.prevSha256 !== undefined && expected?.prevSha256 !== null) {
        if (String(expected.prevSha256) !== String(prevChunkSha256 ?? "")) {
          throw new Error(`Chunk ${i} prevSha256 does not match manifest`);
        }
      }
      if (expected?.rows !== undefined && expected?.rows !== null) {
        const expectedRows = Number(expected.rows);
        if (Number.isFinite(expectedRows) && expectedRows !== partRows) {
          throw new Error(`Chunk ${i} row count does not match manifest`);
        }
      }

      const linkHash = sha256Hex(`${prevLinkHash}:${partSha256}`);
      if (expected?.linkHash && String(expected.linkHash) !== linkHash) {
        throw new Error(`Chunk ${i} linkHash does not match manifest`);
      }

      prevChunkSha256 = partSha256;
      prevLinkHash = linkHash;
    }

    dataSha256 = dataHash.digest("hex");
    if (manifest?.dataSha256 && String(manifest.dataSha256) !== dataSha256) {
      throw new Error("Data SHA-256 does not match manifest");
    }
    if (expectedHeadLinkHash && expectedHeadLinkHash !== prevLinkHash) {
      throw new Error("Chunk chain head hash does not match manifest");
    }

    if (params.mode !== "DRY_RUN") {
      for (const st of tableStates.values()) {
        await flushTable(st);
      }
    }

    if (transactionStarted) {
      await exec("COMMIT");
      transactionStarted = false;
    }

    if (params.mode === "IMPORT") {
      if (await tableExists("trade_audit")) {
        await verifyTradeAuditIntegrity(jobId);
      }
      if (await tableExists("order_intent_audit")) {
        await verifyOrderIntentIntegrity(jobId);
      }
    }

    await db
      .update(migrationImportJobs)
      .set({
        status: "COMPLETE",
        completedAt: nowMs(),
        totalsJson: JSON.stringify(counts),
        manifestSha256,
        dataSha256,
        dataPartsJson: JSON.stringify(dataPartsPaths),
        dataPath: dataPartsPaths[0],
        manifestPath: params.manifestPath,
      })
      .where(eq(migrationImportJobs.id, jobId))
      .run();

    await logJob(jobId, "INFO", "Import job completed", { totals: counts, tables: Object.keys(counts) });

    if (params.requestedByAdminId) {
      try {
        await storage.logAdminAction({
          adminId: params.requestedByAdminId,
          userId: 0,
          actionType: "MIGRATION_IMPORT_COMPLETE",
          metadata: {
            jobId,
            mode: params.mode,
            idStrategy: params.idStrategy ?? "PRESERVE",
            scope: manifest?.scope ?? null,
            tables: Object.keys(counts),
            totals: counts,
            manifestSha256,
            dataSha256,
          },
        });
      } catch (e) {
        console.warn("[migration] admin action log failed:", e);
      }
    }
  } catch (err: any) {
    try {
      await exec("ROLLBACK");
    } catch {}
    await logJob(jobId, "ERROR", "Import job failed", { error: String(err?.message ?? err) });
    await db
      .update(migrationImportJobs)
      .set({ status: "FAILED", completedAt: nowMs(), error: String(err?.message ?? err) })
      .where(eq(migrationImportJobs.id, jobId))
      .run();
    if (params.requestedByAdminId) {
      try {
        await storage.logAdminAction({
          adminId: params.requestedByAdminId,
          userId: 0,
          actionType: "MIGRATION_IMPORT_FAILED",
          metadata: {
            jobId,
            mode: params.mode,
            idStrategy: params.idStrategy ?? "PRESERVE",
            error: String(err?.message ?? err),
          },
        });
      } catch (e) {
        console.warn("[migration] admin action log failed:", e);
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

async function verifyTradeAuditIntegrity(jobId: string) {
  try {
    const rows = await queryAll(
      `SELECT trade_id, prev_hash, event_hash, payload_json
       FROM trade_audit
       ORDER BY trade_id ASC, id ASC`
    );
    let currentTradeId: number | null = null;
    let expectedPrev = "GENESIS";
    for (const row of rows) {
      const tradeId = Number(row.trade_id);
      if (currentTradeId !== tradeId) {
        currentTradeId = tradeId;
        expectedPrev = "GENESIS";
      }
      if (row.prev_hash !== expectedPrev) {
        await db.insert(migrationIntegrityChecks).values({
          jobId,
          chainType: "trade_audit",
          entityKey: String(tradeId),
          status: "FAIL",
          failureReason: "prev_hash mismatch",
          verifiedAt: nowMs(),
        }).run();
        return;
      }
      const expectedHash = crypto
        .createHash("sha256")
        .update(`${expectedPrev}\n${row.payload_json || ""}`, "utf8")
        .digest("hex");
      if (row.event_hash !== expectedHash) {
        await db.insert(migrationIntegrityChecks).values({
          jobId,
          chainType: "trade_audit",
          entityKey: String(tradeId),
          status: "FAIL",
          failureReason: "event_hash mismatch",
          verifiedAt: nowMs(),
        }).run();
        return;
      }
      expectedPrev = row.event_hash;
    }
    await db.insert(migrationIntegrityChecks).values({
      jobId,
      chainType: "trade_audit",
      entityKey: "ALL",
      status: "PASS",
      failureReason: null,
      verifiedAt: nowMs(),
    }).run();
  } catch (err: any) {
    await db.insert(migrationIntegrityChecks).values({
      jobId,
      chainType: "trade_audit",
      entityKey: "ALL",
      status: "FAIL",
      failureReason: String(err?.message ?? err),
      verifiedAt: nowMs(),
    }).run();
  }
}

async function verifyOrderIntentIntegrity(jobId: string) {
  try {
    const rows = await queryAll(
      `SELECT correlation_id, prev_hash, event_hash, payload_json
       FROM order_intent_audit
       ORDER BY correlation_id ASC, id ASC`
    );
    let currentCorrelation: string | null = null;
    let expectedPrev = "GENESIS";
    for (const row of rows) {
      const correlationId = String(row.correlation_id);
      if (currentCorrelation !== correlationId) {
        currentCorrelation = correlationId;
        expectedPrev = "GENESIS";
      }
      if (row.prev_hash !== expectedPrev) {
        await db.insert(migrationIntegrityChecks).values({
          jobId,
          chainType: "order_intent_audit",
          entityKey: correlationId,
          status: "FAIL",
          failureReason: "prev_hash mismatch",
          verifiedAt: nowMs(),
        }).run();
        return;
      }
      const expectedHash = crypto
        .createHash("sha256")
        .update(`${expectedPrev}\n${row.payload_json || ""}`, "utf8")
        .digest("hex");
      if (row.event_hash !== expectedHash) {
        await db.insert(migrationIntegrityChecks).values({
          jobId,
          chainType: "order_intent_audit",
          entityKey: correlationId,
          status: "FAIL",
          failureReason: "event_hash mismatch",
          verifiedAt: nowMs(),
        }).run();
        return;
      }
      expectedPrev = row.event_hash;
    }
    await db.insert(migrationIntegrityChecks).values({
      jobId,
      chainType: "order_intent_audit",
      entityKey: "ALL",
      status: "PASS",
      failureReason: null,
      verifiedAt: nowMs(),
    }).run();
  } catch (err: any) {
    await db.insert(migrationIntegrityChecks).values({
      jobId,
      chainType: "order_intent_audit",
      entityKey: "ALL",
      status: "FAIL",
      failureReason: String(err?.message ?? err),
      verifiedAt: nowMs(),
    }).run();
  }
}
