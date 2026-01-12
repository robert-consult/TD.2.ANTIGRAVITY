import { dbClient } from "@db";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export type GriftDbClient = Pool | PoolClient;

export type GriftPreparedStatement = {
  get<T extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<T | undefined>;
  all<T extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<T[]>;
  run(...params: any[]): Promise<{ changes: number; lastInsertRowid: number | null }>;
};

export type GriftDb = {
  prepare(sql: string): GriftPreparedStatement;
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: any[]): Promise<QueryResult<T>>;
};

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

export function griftDbFromClient(client: GriftDbClient): GriftDb {
  return {
    prepare(sql: string) {
      const text = convertQuestionMarks(sql);
      return {
        async get<T extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<T | undefined> {
          const result = await client.query<T>(text, params);
          return result.rows[0];
        },
        async all<T extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<T[]> {
          const result = await client.query<T>(text, params);
          return result.rows;
        },
        async run(...params: any[]): Promise<{ changes: number; lastInsertRowid: number | null }> {
          const result = await client.query(text, params);
          const lastInsertRowid =
            result.rows && result.rows.length > 0 && "id" in result.rows[0]
              ? Number((result.rows[0] as any).id)
              : null;
          return { changes: result.rowCount ?? 0, lastInsertRowid };
        },
      };
    },
    query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: any[]): Promise<QueryResult<T>> {
      return client.query<T>(sql, params ?? []);
    },
  };
}

export function getGriftDb(): GriftDb {
  return griftDbFromClient(dbClient);
}

export async function withGriftClient<T>(
  fn: (db: GriftDb, client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await dbClient.connect();
  try {
    const db = griftDbFromClient(client);
    return await fn(db, client);
  } finally {
    client.release();
  }
}

export async function withGriftTransaction<T>(
  fn: (db: GriftDb, client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await dbClient.connect();
  try {
    await client.query("BEGIN");
    const db = griftDbFromClient(client);
    const result = await fn(db, client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}
