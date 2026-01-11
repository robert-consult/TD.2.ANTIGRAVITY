import Database from 'better-sqlite3';

/**
 * Migration script to add bid/ask columns to quotes table for MetaTrader-style margin system
 */
async function updateQuotesTable() {
  console.log('Updating quotes table to include bid/ask columns...');
  
  try {
    // Use better-sqlite3 directly for checking columns
    const dbInstance = new Database('./trading_app.db');
    
    // Check if the quotes table exists
    const tableExists = dbInstance.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='quotes'"
    ).get();
    
    if (!tableExists) {
      // Create the quotes table with all necessary columns
      dbInstance.exec(`
        CREATE TABLE quotes (
          symbol TEXT PRIMARY KEY,
          price REAL NOT NULL,
          bid REAL,
          ask REAL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created quotes table with all required columns');
    } else {
      // Table exists, check for bid column
      const tableInfo = dbInstance.prepare('PRAGMA table_info(quotes)').all();
      const columnNames = tableInfo.map((col: any) => col.name as string);
      
      // Add bid column if it doesn't exist
      if (!columnNames.includes('bid')) {
        dbInstance.exec('ALTER TABLE quotes ADD COLUMN bid REAL');
        console.log('Added bid column to quotes table');
      }
      
      // Add ask column if it doesn't exist
      if (!columnNames.includes('ask')) {
        dbInstance.exec('ALTER TABLE quotes ADD COLUMN ask REAL');
        console.log('Added ask column to quotes table');
      }
    }
    
    // Close the database connection
    dbInstance.close();
    
    console.log('Quotes table updated successfully');
  } catch (error) {
    console.error('Error updating quotes table:', error);
    throw error;
  }
}

// Run the migration directly
(async () => {
  try {
    await updateQuotesTable();
    console.log('Quotes table migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
})();

export { updateQuotesTable };