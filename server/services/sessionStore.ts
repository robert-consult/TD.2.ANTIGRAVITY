import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import { dbClient } from "@db";
import { getValkey } from "./valkey";

export type SessionStoreKind = "postgres" | "valkey";

export type SessionStoreResolved = {
  kind: SessionStoreKind;
  store: session.Store;
};

const PG_SESSION_TABLE = "session";
const VALKEY_SESSION_PREFIX = "sess:";

function resolveSessionStorePref(): string {
  return String(process.env.SESSION_STORE ?? "").trim().toLowerCase();
}

export async function resolveSessionStore(): Promise<SessionStoreResolved> {
  const pref = resolveSessionStorePref();
  const valkeyUrl = process.env.VALKEY_URL ?? process.env.REDIS_URL ?? "";
  const wantValkey = pref === "valkey" || pref === "redis";

  if (wantValkey) {
    if (!valkeyUrl) {
      throw new Error("SESSION_STORE=valkey requires VALKEY_URL (or REDIS_URL).");
    }

    const client = createClient({ url: valkeyUrl });
    client.on("error", (err) => {
      console.error("[session] Valkey client error:", err);
    });
    await client.connect();

    return {
      kind: "valkey",
      store: new RedisStore({
        client,
        prefix: "sess:",
      }),
    };
  }

  const PgStore = connectPgSimple(session);
  return {
    kind: "postgres",
    store: new PgStore({
      pool: dbClient,
      tableName: PG_SESSION_TABLE,
      createTableIfMissing: true,
      pruneSessionInterval: 900000,
    }),
  };
}

export async function destroyStoredSession(sid: string): Promise<void> {
  const pref = resolveSessionStorePref();
  const valkeyUrl = process.env.VALKEY_URL ?? process.env.REDIS_URL ?? "";
  const wantValkey = pref === "valkey" || pref === "redis";

  if (wantValkey && valkeyUrl) {
    const client = getValkey();
    if (!client) return;
    try {
      await client.del(`${VALKEY_SESSION_PREFIX}${sid}`);
    } catch {
      // ignore
    }
    return;
  }

  try {
    await dbClient.query(`DELETE FROM ${PG_SESSION_TABLE} WHERE sid = $1`, [sid]);
  } catch {
    // ignore
  }
}
