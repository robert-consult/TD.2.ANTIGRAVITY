// @ts-nocheck
import Database from 'better-sqlite3';
import path from 'path';

// This script adds the lots column to the trades table if it doesn't exist
// and populates it with calculated values from the size column

async function fixLotsColumn() {
  try {
    console.log('Starting to fix lots column...');
    
    // Connect directly to SQLite database
    const dbPath = path.join(process.cwd(), 'trading_app.db');
    console.log(`Opening database at: ${dbPath}`);
    const sqlite = new Database(dbPath);
    
    // Check if lots column exists by checking table info
    const columns = sqlite.prepare('PRAGMA table_info(trades)').all();
    const hasLotsColumn = columns.some(col => col.name === 'lots');
    
    if (hasLotsColumn) {
      console.log('Lots column already exists, skipping migration');
    } else {
      console.log('Adding lots column to trades table...');
      
      // Add the lots column
      sqlite.prepare('ALTER TABLE trades ADD COLUMN lots INTEGER').run();
      console.log('Column added successfully');
      
      // Update existing records
      sqlite.prepare('UPDATE trades SET lots = CAST(size / 100000 AS INTEGER) WHERE lots IS NULL').run();
      console.log('Existing records updated with lots values');
    }
    
    // Close the database connection
    sqlite.close();
    console.log('Lots column fix completed successfully');
  } catch (error) {
    console.error('Error fixing lots column:', error);
  }
}

// Run the migration
fixLotsColumn()
  .then(() => console.log('Done'))
  .catch((error) => console.error('Migration failed:', error));