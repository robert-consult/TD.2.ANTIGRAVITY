// @ts-nocheck
import Database from 'better-sqlite3';
import path from 'path';

// This script updates all instrument lot sizes to use 1-50 range instead of 1000-100000

async function fixLotSizes() {
  try {
    console.log('Starting to fix lot sizes...');
    
    // Connect directly to SQLite database
    const dbPath = path.join(process.cwd(), 'trading_app.db');
    console.log(`Opening database at: ${dbPath}`);
    const sqlite = new Database(dbPath);
    
    // Update minLot and maxLot for all symbols
    console.log('Updating lot sizes for all instruments...');
    const updateResult = sqlite.prepare('UPDATE symbol_configs SET minLot = 1, maxLot = 50').run();
    console.log(`Updated ${updateResult.changes} instruments`);
    
    // Verify the changes
    const symbols = sqlite.prepare('SELECT id, symbol, minLot, maxLot FROM symbol_configs').all();
    console.log('Updated instrument lot sizes:');
    for (const symbol of symbols) {
      console.log(`- ${symbol.symbol}: minLot=${symbol.minLot}, maxLot=${symbol.maxLot}`);
    }
    
    // Close the database connection
    sqlite.close();
    console.log('Lot size update completed successfully');
  } catch (error) {
    console.error('Error fixing lot sizes:', error);
  }
}

// Run the update
fixLotSizes()
  .then(() => console.log('Done'))
  .catch((error) => console.error('Update failed:', error));