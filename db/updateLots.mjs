// ES Module version to update lot sizes
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Connect to the database
const dbPath = join(__dirname, '..', 'trading_app.db');
console.log(`Opening database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

// Update the lot sizes
db.run('UPDATE symbol_configs SET min_lot = 1, max_lot = 50', function(err) {
  if (err) {
    console.error('Error updating lot sizes:', err);
  } else {
    console.log(`Successfully updated ${this.changes} instruments`);
  }
  
  // Query to verify the changes
  db.all('SELECT id, symbol, min_lot, max_lot FROM symbol_configs', (err, rows) => {
    if (err) {
      console.error('Error querying updated data:', err);
    } else {
      console.log('Updated instrument lot sizes:');
      rows.forEach(row => {
        console.log(`- ${row.symbol}: minLot=${row.minLot}, maxLot=${row.maxLot}`);
      });
    }
    
    // Close the database
    db.close();
  });
});