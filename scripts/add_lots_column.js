import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Open the database
const db = new sqlite3.Database(join(__dirname, '../trading_app.db'), (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to the database.');
});

// Run the migration
db.serialize(() => {
  // Check if 'lots' column already exists
  db.get("PRAGMA table_info(trades)", (err, rows) => {
    if (err) {
      console.error('Error checking table schema:', err.message);
      closeDb();
      return;
    }
    
    // If the column doesn't exist, add it
    const hasLotsColumn = rows && rows.some(row => row.name === 'lots');
    if (!hasLotsColumn) {
      console.log('Adding lots column to trades table...');
      
      // Add lots column
      db.run("ALTER TABLE trades ADD COLUMN lots INTEGER", (err) => {
        if (err) {
          console.error('Error adding lots column:', err.message);
          closeDb();
          return;
        }
        
        // Update existing records to set lots based on size
        db.run("UPDATE trades SET lots = size / 100000 WHERE lots IS NULL", (err) => {
          if (err) {
            console.error('Error updating lots values:', err.message);
          } else {
            console.log('Successfully added and populated lots column!');
          }
          closeDb();
        });
      });
    } else {
      console.log('Lots column already exists.');
      closeDb();
    }
  });
});

// Close the database connection
function closeDb() {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
  });
}