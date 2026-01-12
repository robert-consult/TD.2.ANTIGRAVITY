import { dbClient } from "@db";
import type { PoolClient } from "pg";

export async function withI18nClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await dbClient.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withI18nTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withI18nClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
}
