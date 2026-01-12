import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, dbClient } from "../db";

async function main() {
  try {
    await migrate(db, {
      migrationsFolder: "db/migrations",
      migrationsSchema: "drizzle",
    });
    console.log("[drizzle] Migrations applied");
  } catch (error) {
    console.error("[drizzle] Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await dbClient.end();
  }
}

void main();
