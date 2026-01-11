// Simple script to update lot sizes using the SQLite3 module
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to the database
const dbPath = path.join(process.cwd(), 'trading_app.db');
console.log(`Opening database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

// Update the lot sizes
db.run('UPDATE symbol_configs SET minLot = 1, maxLot = 50', function(err) {
  if (err) {
    console.error('Error updating lot sizes:', err);
  } else {
    console.log(`Successfully updated ${this.changes} instruments`);
  }
  
  // Query to verify the changes
  db.all('SELECT id, symbol, minLot, maxLot FROM symbol_configs', (err, rows) => {
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