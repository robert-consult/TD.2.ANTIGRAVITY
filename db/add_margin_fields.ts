import { db } from './index';
import { real, sqliteTable } from 'drizzle-orm/sqlite-core';
import Database from 'better-sqlite3';

/**
 * Migration script to add margin-related fields to the users table
 */
async function addMarginFields() {
  console.log('Adding margin-related fields to users table...');
  
  try {
    // Use better-sqlite3 directly for checking columns
    const dbInstance = new Database('./trading_app.db');
    const tableInfo = dbInstance.prepare('PRAGMA table_info(users)').all();
    const columnNames = tableInfo.map((col: any) => col.name as string);
    
    // Add leverage column if it doesn't exist
    if (!columnNames.includes('leverage')) {
      dbInstance.exec('ALTER TABLE users ADD COLUMN leverage REAL NOT NULL DEFAULT 5');
      console.log('Added leverage column');
    }
    
    // Add used_margin column if it doesn't exist
    if (!columnNames.includes('used_margin')) {
      dbInstance.exec('ALTER TABLE users ADD COLUMN used_margin REAL NOT NULL DEFAULT 0');
      console.log('Added used_margin column');
    }
    
    // Add equity column if it doesn't exist
    if (!columnNames.includes('equity')) {
      dbInstance.exec('ALTER TABLE users ADD COLUMN equity REAL NOT NULL DEFAULT 0');
      console.log('Added equity column');
    }
    
    // Add free_margin column if it doesn't exist
    if (!columnNames.includes('free_margin')) {
      dbInstance.exec('ALTER TABLE users ADD COLUMN free_margin REAL NOT NULL DEFAULT 0');
      console.log('Added free_margin column');
    }
    
    // Close the database connection
    dbInstance.close();
    
    console.log('Margin-related fields added successfully');
  } catch (error) {
    console.error('Error adding margin-related fields:', error);
    throw error;
  }
}

// Create quotes table for real-time price tracking
async function createQuotesTable() {
  console.log('Creating quotes table for price tracking...');
  
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS quotes (
        symbol TEXT PRIMARY KEY,
        price REAL NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    console.log('Quotes table created or already exists');
  } catch (error) {
    console.error('Error creating quotes table:', error);
    throw error;
  }
}

async function main() {
  try {
    await addMarginFields();
    await createQuotesTable();
    console.log('Database migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the migration
main();

export { addMarginFields, createQuotesTable };