import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

type Db = InstanceType<typeof Database>;

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

function dbPath(): string {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  return path.resolve(repoRoot, "trading_app.db");
}

function section(title: string) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
}

function tableInfo(db: Db, tableName: string): TableInfoRow[] {
  return db.prepare(`PRAGMA table_info(${tableName});`).all() as TableInfoRow[];
}

function hasColumn(cols: TableInfoRow[], name: string): boolean {
  return cols.some((c) => c.name === name);
}

function schemaSql(db: Db, tableName: string): string | null {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName) as { sql?: string } | undefined;
  return row?.sql ?? null;
}

function pickColumns(cols: TableInfoRow[], names: string[]): TableInfoRow[] {
  const set = new Set(names);
  return cols.filter((c) => set.has(c.name));
}

function printColumns(rows: TableInfoRow[]) {
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(
      `${r.cid}\t${r.name}\t${r.type}\t${r.notnull ? "NOT NULL" : ""}\t${r.dflt_value ?? ""}\t${r.pk ? "PK" : ""}`.trim()
    );
  }
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
  // eslint-disable-next-line no-console
  console.log("botGuard #1:", { allowed: r1.allowed, score: r1.score, proof: r1.proof, status: res1.statusCode });
  // eslint-disable-next-line no-console
  console.log("428 payload:", res1.body);

  const ch = res1.body?.challenge;
  if (!ch?.id || !ch?.serverNonce || !ch?.difficulty) {
    // eslint-disable-next-line no-console
    console.log("No challenge returned; ensure botPowEnabled=true and botPowEnforceSignup=true in system_config.");
    return;
  }

  const start = Date.now();
  let nonce = 0;
  let digest = "";
  while (true) {
    const material = [ch.id, ch.serverNonce, String(nonce), baseHeaders["x-device-fp"], baseHeaders["x-device-install-id"]].join("|");
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
    })
  );

  const req2: any = {
    ...reqBase,
    headers: { ...baseHeaders, "x-bot-proof": token },
  };
  const res2 = makeRes();
  const r2 = await botGuard(req2, res2, { action: "SIGNUP", email: "audit-demo@example.com" });
  // eslint-disable-next-line no-console
  console.log("botGuard #2 (with proof):", { allowed: r2.allowed, score: r2.score, proof: r2.proof, status: res2.statusCode });

  const res3 = makeRes();
  const r3 = await botGuard(req2, res3, { action: "SIGNUP", email: "audit-demo@example.com" });
  // eslint-disable-next-line no-console
  console.log("botGuard #3 (replay same proof):", { allowed: r3.allowed, score: r3.score, proof: r3.proof, status: res3.statusCode, body: res3.body });
}

function main() {
  const p = dbPath();
  const db = new Database(p, { readonly: true, fileMustExist: true });
  try {
    db.pragma("foreign_keys = ON");

    section("DB Path");
    // eslint-disable-next-line no-console
    console.log(p);

    section("users columns (required)");
    const usersCols = tableInfo(db, "users");
    const requiredUsersCols = [
      "is_deleted",
      "inactivated_at",
      "deleted_at",
      "deleted_mode",
      "deleted_reason",
      "deleted_by_admin_id",
      "deletion_exempt",
    ];
    printColumns(pickColumns(usersCols, requiredUsersCols));
    for (const c of requiredUsersCols) {
      // eslint-disable-next-line no-console
      console.log(`${c}: ${hasColumn(usersCols, c) ? "OK" : "MISSING"}`);
    }

    section("Tables (bot/activity)");
    for (const t of ["bot_risk_assessments", "user_deletion_queue"]) {
      const sql = schemaSql(db, t);
      // eslint-disable-next-line no-console
      console.log(`\n-- ${t} --`);
      // eslint-disable-next-line no-console
      console.log(sql ?? "(missing)");
    }

    section("system_config columns (required)");
    const cfgCols = tableInfo(db, "system_config");
    const requiredCfgCols = [
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
    for (const c of requiredCfgCols) {
      // eslint-disable-next-line no-console
      console.log(`${c}: ${hasColumn(cfgCols, c) ? "OK" : "MISSING"}`);
    }

    const presentCfgCols = requiredCfgCols.filter((c) => hasColumn(cfgCols, c));
    if (presentCfgCols.length) {
      const row = db.prepare(`SELECT ${presentCfgCols.join(", ")} FROM system_config WHERE id=1`).get() as any;
      section("system_config id=1 values (present cols)");
      // eslint-disable-next-line no-console
      console.log(row);
    }

    section("PRAGMA foreign_key_check");
    try {
      const fk = db.prepare("PRAGMA foreign_key_check;").all() as any[];
      // eslint-disable-next-line no-console
      console.log(`Rows: ${fk.length}`);
      if (fk.length) {
        // eslint-disable-next-line no-console
        console.log(fk.slice(0, 25));
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.log(`foreign_key_check failed: ${e?.code || "ERROR"} ${e?.message || String(e)}`);
    }

    section("PRAGMA integrity_check");
    try {
      const rows = db.prepare("PRAGMA integrity_check;").all() as any[];
      // eslint-disable-next-line no-console
      console.log(rows.slice(0, 25));
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.log(`integrity_check failed: ${e?.code || "ERROR"} ${e?.message || String(e)}`);
    }
  } finally {
    db.close();
  }
}

main();
await powDemo();
