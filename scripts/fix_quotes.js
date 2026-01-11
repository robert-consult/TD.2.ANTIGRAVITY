import BetterSQLite3 from 'better-sqlite3';

function fixQuotes() {
  try {
    console.log('Fixing quotes table schema...');
    const db = new BetterSQLite3('./trading_app.db');
    
    // Disable foreign keys to allow table recreation
    db.pragma('foreign_keys = OFF');
    
    // Drop the existing quotes table if it exists
    db.exec('DROP TABLE IF EXISTS quotes');
    
    // Create new quotes table with the correct schema
    db.exec(`
      CREATE TABLE quotes (
        symbol TEXT PRIMARY KEY,
        price REAL NOT NULL,
        bid REAL,
        ask REAL,
        updated_at TEXT NOT NULL
      )
    `);
    
    // Re-enable foreign keys
    db.pragma('foreign_keys = ON');
    
    console.log('Quotes table fixed successfully');
    db.close();
    return true;
  } catch (error) {
    console.error('Error fixing quotes table:', error);
    return false;
  }
}

fixQuotes();