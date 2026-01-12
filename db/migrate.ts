import { db } from "./index";
import { symbolConfigs } from "../shared/schema";

async function createTables() {
  console.log("Creating database tables...");
  console.log("Skipping table creation; use db/migrations/*.sql for Postgres.");

  // Seed initial symbol data
  const symbols = [
    {
      symbol: 'EURUSD',
      name: 'Euro / US Dollar',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      spread: 0.0002,
    },
    {
      symbol: 'GBPUSD',
      name: 'British Pound / US Dollar',
      baseCurrency: 'GBP',
      quoteCurrency: 'USD',
      spread: 0.0003,
    },
    {
      symbol: 'USDJPY',
      name: 'US Dollar / Japanese Yen',
      baseCurrency: 'USD',
      quoteCurrency: 'JPY',
      spread: 0.015,
    },
    {
      symbol: 'AUDUSD',
      name: 'Australian Dollar / US Dollar',
      baseCurrency: 'AUD',
      quoteCurrency: 'USD',
      spread: 0.0003,
    }
  ];

  // Insert symbols if they don't exist
  for (const symbol of symbols) {
    try {
      // Check if symbol exists
      const existingSymbol = await db.query.symbolConfigs.findFirst({
        where: (s, { eq }) => eq(s.symbol, symbol.symbol)
      });

      if (!existingSymbol) {
        await db.insert(symbolConfigs).values(symbol);
        console.log(`Added symbol: ${symbol.symbol}`);
      }
    } catch (error) {
      console.error(`Error adding symbol ${symbol.symbol}:`, error);
    }
  }

  console.log("Database migration completed!");
}

// Run migrations
createTables()
  .then(() => {
    console.log("Database successfully initialized");
    process.exit(0);
  })
  .catch(error => {
    console.error("Error initializing database:", error);
    process.exit(1);
  });
