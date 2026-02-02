import { storage } from "../server/storage";
import { db } from "@db";
import { globalSettings, systemConfig, tradeAudit, trades, userVerification } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");
  const nowSec = Math.floor(Date.now() / 1000);
  
  try {
    // Ensure singleton config rows exist (id=1) with defaults
    await db.insert(systemConfig).values({ id: 1 }).onConflictDoNothing();
    await db.insert(globalSettings).values({ id: 1 }).onConflictDoNothing();
    if (process.env.SEED_RELAX_MARKET_HOURS === "1") {
      // E2E/CI must be deterministic regardless of the real-world day/time.
      // (CI can run on weekends; market windows should not hard-block the test suite.)
      await db
        .update(globalSettings)
        .set({ allowWeekendTrading: true, marketOpenTime: "00:00", marketCloseTime: "23:59", minHoldSec: 0 })
        .where(eq(globalSettings.id, 1));
    }

    // Create admin user if it doesn't exist
    const adminEmail = "admin@local.test";
    const existingAdmin = await storage.getUserByEmail(adminEmail);
    
    if (!existingAdmin) {
      const admin = await storage.createUser({
        email: adminEmail,
        username: "admin",
        password: "changeme",
        isAdmin: true,
        balance: "1000000.00" // Set starting capital to $1,000,000
      });
      await db.insert(userVerification).values({ userId: admin.id, emailVerifiedAt: nowSec, updatedAt: nowSec }).onConflictDoUpdate({
        target: userVerification.userId,
        set: { emailVerifiedAt: nowSec, updatedAt: nowSec },
      });
      console.log("Admin user created successfully");
    } else {
      // Update existing admin's balance to $1,000,000 if needed
      if (existingAdmin.balance !== "1000000.00") {
        await storage.updateUserBalance(existingAdmin.id, "1000000.00");
        console.log("Updated admin user balance to $1,000,000");
      }
      console.log("Admin user already exists");
      await db.insert(userVerification).values({ userId: existingAdmin.id, emailVerifiedAt: nowSec, updatedAt: nowSec }).onConflictDoUpdate({
        target: userVerification.userId,
        set: { emailVerifiedAt: nowSec, updatedAt: nowSec },
      });
    }
    
    // Create demo user if it doesn't exist
    const demoEmail = "demo@tradingfx.com";
    const demoPassword = "demo1234";
    const existingDemo = await storage.getUserByEmail(demoEmail);
    
    if (!existingDemo) {
      const demo = await storage.createUser({
        email: demoEmail,
        username: "demo",
        password: demoPassword,
        isAdmin: false,
        balance: "1000000.00" // Set starting capital to $1,000,000
      });
      await db.insert(userVerification).values({ userId: demo.id, emailVerifiedAt: nowSec, updatedAt: nowSec }).onConflictDoUpdate({
        target: userVerification.userId,
        set: { emailVerifiedAt: nowSec, updatedAt: nowSec },
      });
      console.log("Demo user created successfully");
    } else {
      // Update existing demo user's balance to $1,000,000 if needed
      if (existingDemo.balance !== "1000000.00") {
        await storage.updateUserBalance(existingDemo.id, "1000000.00");
        console.log("Updated demo user balance to $1,000,000");
      }
      await storage.updateUser(existingDemo.id, { password: demoPassword });
      console.log("Updated demo user password");
      console.log("Demo user already exists");

      await db.insert(userVerification).values({ userId: existingDemo.id, emailVerifiedAt: nowSec, updatedAt: nowSec }).onConflictDoUpdate({
        target: userVerification.userId,
        set: { emailVerifiedAt: nowSec, updatedAt: nowSec },
      });
    }
    
    // Ensure we have all required symbol configurations with proper spreads
    const symbols = [
      { symbol: "EURUSD", name: "Euro / US Dollar" },
      { symbol: "GBPUSD", name: "British Pound / US Dollar" },
      { symbol: "USDJPY", name: "US Dollar / Japanese Yen" },
      { symbol: "AUDUSD", name: "Australian Dollar / US Dollar" }
    ];
    
    for (const symbolData of symbols) {
      const existingSymbol = await storage.getSymbolConfigBySymbol(symbolData.symbol);
      
      if (!existingSymbol) {
        await storage.createSymbolConfig({
          symbol: symbolData.symbol,
          name: symbolData.name,
          minSpreadPips: 2.0 // Minimum spread of 2 pips
        });
        console.log(`Created symbol config for ${symbolData.symbol}`);
      } else {
        // Update spread if needed
        if (!existingSymbol.minSpreadPips || existingSymbol.minSpreadPips < 2.0) {
          await storage.updateSymbolConfig(existingSymbol.id, {
            ...existingSymbol,
            minSpreadPips: 2.0
          });
          console.log(`Updated min spread for ${symbolData.symbol} to 2 pips`);
        }
      }
    }

    if (process.env.SEED_RESET_TRADES === "1") {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Refusing to reset trades in production (SEED_RESET_TRADES=1).");
      }
      if (process.env.SEED_DESTRUCTIVE_OK !== "1") {
        throw new Error(
          "Refusing destructive seed without SEED_DESTRUCTIVE_OK=1 (SEED_RESET_TRADES=1). " +
            "This guard prevents accidental data loss on shared databases.",
        );
      }
      const databaseUrl = process.env.DATABASE_URL ?? "";
      let host: string | null = null;
      try {
        host = new URL(databaseUrl).hostname || null;
      } catch {
        host = null;
      }
      const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
      if (!isLocalHost && process.env.SEED_DESTRUCTIVE_NONLOCAL_OK !== "1") {
        throw new Error(
          `Refusing destructive seed on non-local DATABASE_URL host (${host ?? "unparseable"}). ` +
            "Set SEED_DESTRUCTIVE_NONLOCAL_OK=1 to override.",
        );
      }
      console.log("Resetting trades for deterministic E2E...");
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('tradequip.allow_destructive', '1', true)`);
        await tx.delete(tradeAudit);
        await tx.delete(trades);
      });
    }
    
    console.log("Seeding completed successfully");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}

// Run seed function
seed()
  .catch(error => {
    console.error("Seed error:", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
