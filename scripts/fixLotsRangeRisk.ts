import { db } from "../db";
import { symbolConfigs } from "../shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../server/storage";

/**
 * This script fixes the risk management checks to properly handle 
 * the extended lot size range of 1-50 in the database
 */
async function fixLotRangeRisk() {
  console.log("Updating risk parameters to accommodate 1-50 lots range...");
  
  try {
    // Update the max lots in symbol configurations (already done by another script)
    // Now let's double check all symbol configs
    const allSymbols = await storage.getAllSymbolConfigs();
    
    for (const symbol of allSymbols) {
      if (symbol.maxLot !== 5000000) { // Should be 50 standard lots
        console.log(`Fixing max lot for ${symbol.symbol} (currently ${symbol.maxLot / 100000} lots)`);
        
        await storage.updateSymbolConfig(symbol.id, {
          ...symbol,
          maxLot: 5000000 // 50 standard lots
        });
        
        console.log(`✓ Fixed ${symbol.symbol} to allow 50 lots max`);
      } else {
        console.log(`✓ ${symbol.symbol} already has correct max lot of 50`);
      }
    }
    
    // Also fix the risk settings in the database
    console.log("Checking/updating user risk settings...");
    const userSettings = await storage.listUsersWithSettings();
    
    for (const setting of userSettings) {
      // No direct changes needed to user settings
      // Since leverage is already correctly set
      console.log(`User ${setting.userId} has leverage: ${setting.leverage}x`);
    }
    
    console.log("Lot range and risk parameters successfully updated!");
  } catch (error) {
    console.error("Error fixing lot range:", error);
  }
}

// Execute the function
fixLotRangeRisk()
  .catch(error => {
    console.error("Script execution error:", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });