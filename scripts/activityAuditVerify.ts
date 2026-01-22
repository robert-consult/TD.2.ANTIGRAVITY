import crypto from "node:crypto";

import { dbClient } from "../db";

type Row = Record<string, unknown>;

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function tableExists(tableName: string): Promise<boolean> {
  const res = await dbClient.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1",
    [tableName],
  );
  return (res.rowCount ?? 0) > 0;
}

async function tableColumns(tableName: string): Promise<Set<string>> {
  const res = await dbClient.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
    [tableName],
  );
  return new Set(res.rows.map((r: any) => String(r.column_name)));
}

function hasColumn(cols: Set<string>, name: string): boolean {
  return cols.has(name);
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function b64urlEncodeUtf8(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function leadingZeroBitsOfHex(hex: string): number {
  let bits = 0;
  for (let i = 0; i < hex.length; i++) {
    const v = parseInt(hex[i]!, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    if (v < 8) bits += 1;
    if (v < 4) bits += 1;
    if (v < 2) bits += 1;
    return bits;
  }
  return bits;
}

async function powDemo() {
  section("PoW Challenge Demo (botGuard, no server)");
  const { botGuard } = await import("../server/security/botGuard");

  const baseHeaders: Record<string, string> = {
    "user-agent": "HeadlessChrome/120 audit-demo",
    "x-device-fp": "fp_audit_demo",
    "x-device-install-id": "inst_audit_demo",
    "x-client-tz": "UTC",
  };

  const makeRes = () => {
    const res: any = {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  const reqBase: any = {
    headers: { ...baseHeaders },
    ip: "127.0.0.1",
  };

  const res1 = makeRes();
  const r1 = await botGuard(reqBase, res1, { action: "SIGNUP", email: "audit-demo@example.com" });
  console.log("botGuard #1:", { allowed: r1.allowed, score: r1.score, proof: r1.proof, status: res1.statusCode });
  console.log("428 payload:", res1.body);

  const ch = res1.body?.challenge;
  if (!ch?.id || !ch?.serverNonce || !ch?.difficulty) {
    console.log("No challenge returned; ensure botPowEnabled=true and botPowEnforceSignup=true in system_config.");
    return;
  }

  const start = Date.now();
  let nonce = 0;
  let digest = "";
  while (true) {
    const material = [
      ch.id,
      ch.serverNonce,
      String(nonce),
      baseHeaders["x-device-fp"],
      baseHeaders["x-device-install-id"],
    ].join("|");
    digest = sha256Hex(material);
    if (leadingZeroBitsOfHex(digest) >= Number(ch.difficulty)) break;
    nonce++;
    if (nonce % 25000 === 0 && Date.now() - start > 5000) {
      throw new Error("PoW solve timeout (>5s). Lower botPowBaseDifficulty for demo, or try again.");
    }
  }

  const token = b64urlEncodeUtf8(
    JSON.stringify({
      id: ch.id,
      solutionNonce: nonce,
      ts: Math.floor(Date.now() / 1000),
      deviceFp: baseHeaders["x-device-fp"],
      deviceInstallId: baseHeaders["x-device-install-id"],
      digest,
    }),
  );

  const req2: any = {
    ...reqBase,
    headers: { ...baseHeaders, "x-bot-proof": token },
  };
  const res2 = makeRes();
  const r2 = await botGuard(req2, res2, { action: "SIGNUP", email: "audit-demo@example.com" });
  console.log("botGuard #2 (with proof):", { allowed: r2.allowed, score: r2.score, proof: r2.proof, status: res2.statusCode });

  const res3 = makeRes();
  const r3 = await botGuard(req2, res3, { action: "SIGNUP", email: "audit-demo@example.com" });
  console.log("botGuard #3 (replay same proof):", {
    allowed: r3.allowed,
    score: r3.score,
    proof: r3.proof,
    status: res3.statusCode,
    body: res3.body,
  });
}

async function main() {
  const nameRow = await dbClient.query<{ db_name: string }>("SELECT current_database() AS db_name");
  const dbName = nameRow.rows[0]?.db_name ?? "unknown";

  section("Database");
  console.log(dbName);

  section("users columns (required)");
  {
    const cols = await tableColumns("users");
    const required = [
      "is_deleted",
      "inactivated_at",
      "deleted_at",
      "deleted_mode",
      "deleted_reason",
      "deleted_by_admin_id",
      "deletion_exempt",
    ];
    for (const c of required) {
      console.log(`${c}: ${hasColumn(cols, c) ? "OK" : "MISSING"}`);
    }
  }

  section("Tables (bot/activity)");
  for (const t of ["bot_risk_assessments", "user_deletion_queue"]) {
    const exists = await tableExists(t);
    console.log(`${t}: ${exists ? "OK" : "MISSING"}`);
    if (!exists) continue;
    try {
      const countRes = await dbClient.query<{ n: string | number }>(`SELECT COUNT(1) AS n FROM ${t}`);
      console.log(`  rows: ${countRes.rows[0]?.n ?? 0}`);
    } catch (e: any) {
      console.log(`  rows: ERROR ${e?.message ?? String(e)}`);
    }
  }

  section("system_config columns (required)");
  {
    const cols = await tableColumns("system_config");
    const required = [
      "inactivity_threshold_days",
      "deletion_grace_days",
      "bot_score_threshold",
      "bot_pow_enabled",
      "bot_pow_enforce_signup",
      "bot_pow_enforce_login",
      "bot_pow_challenge_score",
      "bot_pow_base_difficulty",
      "bot_pow_max_difficulty",
      "bot_pow_ttl_sec",
      "bot_valkey_enabled",
      "activity_auto_queue_inactive",
      "activity_auto_soft_delete",
    ];
    for (const c of required) {
      console.log(`${c}: ${hasColumn(cols, c) ? "OK" : "MISSING"}`);
    }

    const present = required.filter((c) => cols.has(c));
    if (present.length) {
      const rowRes = await dbClient.query<Row>(`SELECT ${present.join(", ")} FROM system_config WHERE id=1`);
      section("system_config id=1 values (present cols)");
      console.log(rowRes.rows[0] ?? null);
    }
  }
}

let exitCode = 0;
try {
  await main();
  await powDemo();
} catch (e) {
  exitCode = 1;
  console.error("[audit:activity] FAIL:", e);
} finally {
  try {
    await dbClient.end();
  } catch {}
}

process.exit(exitCode);
