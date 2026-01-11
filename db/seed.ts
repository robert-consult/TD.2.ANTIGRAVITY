import { storage } from "../server/storage";

async function seed() {
  console.log("Seeding database...");
  
  try {
    // Create admin user if it doesn't exist
    const adminEmail = "admin@local.test";
    const existingAdmin = await storage.getUserByEmail(adminEmail);
    
    if (!existingAdmin) {
      await storage.createUser({
        email: adminEmail,
        username: "admin",
        password: "changeme",
        isAdmin: true,
        balance: "1000000.00" // Set starting capital to $1,000,000
      });
      console.log("Admin user created successfully");
    } else {
      // Update existing admin's balance to $1,000,000 if needed
      if (existingAdmin.balance !== "1000000.00") {
        await storage.updateUserBalance(existingAdmin.id, "1000000.00");
        console.log("Updated admin user balance to $1,000,000");
      }
      console.log("Admin user already exists");
    }
    
    // Create demo user if it doesn't exist
    const demoEmail = "demo@tradingfx.com";
    const existingDemo = await storage.getUserByEmail(demoEmail);
    
    if (!existingDemo) {
      await storage.createUser({
        email: demoEmail,
        username: "demo",
        password: "demo123",
        isAdmin: false,
        balance: "1000000.00" // Set starting capital to $1,000,000
      });
      console.log("Demo user created successfully");
    } else {
      // Update existing demo user's balance to $1,000,000 if needed
      if (existingDemo.balance !== "1000000.00") {
        await storage.updateUserBalance(existingDemo.id, "1000000.00");
        console.log("Updated demo user balance to $1,000,000");
      }
      console.log("Demo user already exists");
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