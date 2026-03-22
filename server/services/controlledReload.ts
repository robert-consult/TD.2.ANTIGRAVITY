import { db } from "@db";
import { runtimeReloadStatus } from "@shared/schema";
import type {
  ControlledReloadAcknowledgement,
  ControlledReloadAckState,
  ControlledReloadDomain,
  ControlledReloadRequiredScope,
  ControlledReloadStatus,
} from "@shared/runtimeConfig";
import { eq, sql } from "drizzle-orm";

type RuntimeReloadStatusRow = typeof runtimeReloadStatus.$inferSelect;

const DEFAULT_REQUIRED_SCOPE: Record<ControlledReloadDomain, ControlledReloadRequiredScope> = {
  "quotes.transport.feed": "reload",
  "quotes.providers": "reload",
};

const CONTROLLED_RELOAD_NODE_ID =
  String(process.env.POD_NAME || process.env.HOSTNAME || "").trim() || `pid:${process.pid}`;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function buildDefaultStatus(domain: ControlledReloadDomain): ControlledReloadStatus {
  return {
    domain,
    requestedVersion: 0,
    requestedAt: null,
    requestedBy: null,
    requiredScope: DEFAULT_REQUIRED_SCOPE[domain],
    changedKeys: [],
    status: "idle",
    acknowledgements: [],
    lastAppliedVersion: null,
    lastAppliedAt: null,
    lastError: null,
    effectiveState: null,
    updatedAt: null,
  };
}

function rowToStatus(row: RuntimeReloadStatusRow | null | undefined, domain: ControlledReloadDomain): ControlledReloadStatus {
  if (!row) return buildDefaultStatus(domain);
  return {
    domain,
    requestedVersion: Number(row.requestedVersion ?? 0),
    requestedAt: typeof row.requestedAt === "number" ? row.requestedAt : null,
    requestedBy: typeof row.requestedBy === "string" && row.requestedBy.trim() ? row.requestedBy : null,
    requiredScope:
      row.requiredScope === "runtime" ||
      row.requiredScope === "restart" ||
      row.requiredScope === "deploy"
        ? row.requiredScope
        : "reload",
    changedKeys: parseJsonArray<string>(row.changedKeysJson).map((key) => String(key)).filter(Boolean),
    status:
      row.status === "pending" || row.status === "applied" || row.status === "failed"
        ? row.status
        : "idle",
    acknowledgements: parseJsonArray<ControlledReloadAcknowledgement>(row.acknowledgementsJson)
      .map((ack) => {
        const ackStatus: ControlledReloadAckState = ack?.status === "failed" ? "failed" : "applied";
        return {
          actorId: String(ack?.actorId ?? ""),
          role: String(ack?.role ?? ""),
          nodeId: String(ack?.nodeId ?? ""),
          version: Number(ack?.version ?? 0),
          status: ackStatus,
          updatedAt: Number(ack?.updatedAt ?? 0),
          error: typeof ack?.error === "string" && ack.error.trim() ? ack.error : null,
          effectiveState:
            ack?.effectiveState && typeof ack.effectiveState === "object" && !Array.isArray(ack.effectiveState)
              ? (ack.effectiveState as Record<string, unknown>)
              : null,
        };
      })
      .filter((ack) => ack.actorId && ack.role && ack.nodeId && Number.isFinite(ack.version)),
    lastAppliedVersion: typeof row.lastAppliedVersion === "number" ? row.lastAppliedVersion : null,
    lastAppliedAt: typeof row.lastAppliedAt === "number" ? row.lastAppliedAt : null,
    lastError: typeof row.lastError === "string" && row.lastError.trim() ? row.lastError : null,
    effectiveState: parseJsonRecord(row.effectiveStateJson),
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
  };
}

async function ensureReloadRow(domain: ControlledReloadDomain) {
  await db
    .insert(runtimeReloadStatus)
    .values({
      domain,
      requiredScope: DEFAULT_REQUIRED_SCOPE[domain],
    } as typeof runtimeReloadStatus.$inferInsert)
    .onConflictDoNothing();
}

type SqlExecution = {
  execute(query: unknown): Promise<unknown>;
};

async function lockReloadRow(executor: SqlExecution, domain: ControlledReloadDomain) {
  const lockResult = await executor.execute(
    sql`
      SELECT ${runtimeReloadStatus.domain}
      FROM ${runtimeReloadStatus}
      WHERE ${runtimeReloadStatus.domain} = ${domain}
      FOR UPDATE
    `,
  );

  if (!((lockResult as any)?.rows?.length)) {
    throw new Error("Controlled reload row missing while acquiring lock");
  }
}

export async function getControlledReloadStatus(domain: ControlledReloadDomain): Promise<ControlledReloadStatus> {
  await ensureReloadRow(domain);
  const row = await db.query.runtimeReloadStatus.findFirst({
    where: eq(runtimeReloadStatus.domain, domain),
  });
  return rowToStatus(row ?? null, domain);
}

export async function requestControlledReload(params: {
  domain: ControlledReloadDomain;
  requestedBy?: string | null;
  requiredScope?: ControlledReloadRequiredScope;
  changedKeys?: string[];
}): Promise<ControlledReloadStatus> {
  const changedKeys = [...new Set((params.changedKeys ?? []).map((key) => String(key).trim()).filter(Boolean))];
  const changedKeysJson = JSON.stringify(changedKeys);
  const updatedAt = nowSec();

  await ensureReloadRow(params.domain);

  const row = await db.transaction(async (tx) => {
    await lockReloadRow(tx, params.domain);

    const baseRow = await tx.query.runtimeReloadStatus.findFirst({
      where: eq(runtimeReloadStatus.domain, params.domain),
    });
    const current = rowToStatus(baseRow ?? null, params.domain);
    const requiredScope = params.requiredScope ?? current.requiredScope ?? DEFAULT_REQUIRED_SCOPE[params.domain];
    const requestedVersion = current.requestedVersion + 1;

    await tx
      .update(runtimeReloadStatus)
      .set({
        requestedVersion,
        requestedAt: updatedAt,
        requestedBy: params.requestedBy ?? null,
        requiredScope,
        changedKeysJson,
        status: "pending",
        acknowledgementsJson: "[]",
        lastError: null,
        updatedAt,
      })
      .where(eq(runtimeReloadStatus.domain, params.domain));

    const refreshedRow = await tx.query.runtimeReloadStatus.findFirst({
      where: eq(runtimeReloadStatus.domain, params.domain),
    });

    return refreshedRow ?? baseRow;
  });

  return rowToStatus(row ?? null, params.domain);
}

function mergeAcknowledgement(
  current: ControlledReloadAcknowledgement[],
  next: ControlledReloadAcknowledgement,
): ControlledReloadAcknowledgement[] {
  const actorId = next.actorId;
  const merged = current.filter((ack) => ack.actorId !== actorId);
  merged.push(next);
  merged.sort((a, b) => a.actorId.localeCompare(b.actorId));
  return merged;
}

async function writeAcknowledgement(params: {
  domain: ControlledReloadDomain;
  version: number;
  role: string;
  status: "applied" | "failed";
  effectiveState?: Record<string, unknown> | null;
  error?: string | null;
  nodeId?: string | null;
}) {
  await ensureReloadRow(params.domain);
  const actorNodeId = String(params.nodeId ?? CONTROLLED_RELOAD_NODE_ID).trim() || CONTROLLED_RELOAD_NODE_ID;
  const actorId = `${params.role}:${actorNodeId}`;
  const updatedAt = nowSec();

  const acknowledgement: ControlledReloadAcknowledgement = {
    actorId,
    role: params.role,
    nodeId: actorNodeId,
    version: params.version,
    status: params.status,
    updatedAt,
    error: typeof params.error === "string" && params.error.trim() ? params.error : null,
    effectiveState:
      params.effectiveState && Object.keys(params.effectiveState).length > 0 ? params.effectiveState : null,
  };

  const row = await db.transaction(async (tx) => {
    await lockReloadRow(tx, params.domain);

    const currentRow = await tx.query.runtimeReloadStatus.findFirst({
      where: eq(runtimeReloadStatus.domain, params.domain),
    });
    const current = rowToStatus(currentRow ?? null, params.domain);
    const acknowledgements = mergeAcknowledgement(current.acknowledgements, acknowledgement);

    const setValues: Partial<typeof runtimeReloadStatus.$inferInsert> = {
      acknowledgementsJson: JSON.stringify(acknowledgements),
      updatedAt,
    };

    if (params.version === current.requestedVersion) {
      setValues.status = params.status;
      setValues.lastError = acknowledgement.error;
      if (params.status === "applied") {
        setValues.lastAppliedVersion = params.version;
        setValues.lastAppliedAt = updatedAt;
        setValues.effectiveStateJson = JSON.stringify(params.effectiveState ?? current.effectiveState ?? {});
      }
    }

    await tx
      .update(runtimeReloadStatus)
      .set(setValues)
      .where(eq(runtimeReloadStatus.domain, params.domain));

    const refreshedRow = await tx.query.runtimeReloadStatus.findFirst({
      where: eq(runtimeReloadStatus.domain, params.domain),
    });

    return refreshedRow ?? currentRow;
  });

  return rowToStatus(row ?? null, params.domain);
}

export async function markControlledReloadApplied(params: {
  domain: ControlledReloadDomain;
  version: number;
  role: string;
  effectiveState?: Record<string, unknown> | null;
  nodeId?: string | null;
}) {
  return writeAcknowledgement({
    ...params,
    status: "applied",
  });
}

export async function markControlledReloadFailed(params: {
  domain: ControlledReloadDomain;
  version: number;
  role: string;
  error: string;
  effectiveState?: Record<string, unknown> | null;
  nodeId?: string | null;
}) {
  return writeAcknowledgement({
    ...params,
    status: "failed",
  });
}

export function getControlledReloadNodeId() {
  return CONTROLLED_RELOAD_NODE_ID;
}
