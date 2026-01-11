// scripts/migrate-mongo.js
const { db } = require("../db");
const { users, trades } = require("../shared/schema");
const { eq } = require("drizzle-orm");

async function migrate() {
  console.log("Running database migrations for TradeQuip Phase-2...");

  try {
    // Update all users to have 1,000,000 initial balance
    await db.update(users)
      .set({
        balance: "1000000.00"
      })
      .where(eq(users.balance, "10000.00"));

    console.log("Updated initial balance to $1,000,000");

    // Add indexes for trade queries
    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  }
}

migrate();