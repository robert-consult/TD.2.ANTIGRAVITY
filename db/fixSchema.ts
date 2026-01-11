// @ts-nocheck
import { db } from "./index";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Running database schema migrations for TradeQuip Phase-2...");

  try {
    // Update user balances to $1,000,000
    const updateBalanceResult = await db.execute(
      sql`UPDATE users SET balance = '1000000.00' WHERE balance != '1000000.00'`
    );
    console.log("Updated user balances to $1,000,000");
    
    console.log("Database migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit(0);
  }
}

// Execute the migration
migrate();