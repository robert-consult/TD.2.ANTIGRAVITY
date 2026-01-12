import { dbClient } from "./index";

/**
 * Migration script to add margin-related fields to the users table
 */
async function addMarginFields() {
  console.log('Adding margin-related fields to users table...');
  
  try {
    const statements = [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS leverage real NOT NULL DEFAULT 5",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS used_margin real NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS equity real NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS free_margin real NOT NULL DEFAULT 0",
    ];

    for (const stmt of statements) {
      await dbClient.query(stmt);
    }
    
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
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        symbol text PRIMARY KEY,
        price real NOT NULL DEFAULT 0,
        bid real,
        ask real,
        updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
        is_stale boolean NOT NULL DEFAULT false,
        last_api_update bigint
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
