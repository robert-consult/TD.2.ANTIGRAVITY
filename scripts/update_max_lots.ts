import { storage } from "../server/storage";

async function updateMaxLots() {
  console.log("Updating maximum lot sizes to 50 lots ($5,000,000)...");
  
  try {
    // Get all symbol configurations
    const symbols = await storage.getAllSymbolConfigs();
    
    for (const symbol of symbols) {
      // Update to 50 standard lots (5,000,000 units)
      await storage.updateSymbolConfig(symbol.id, {
        ...symbol,
        maxLot: 5000000 // 50 standard lots
      });
      console.log(`Updated max lot size for ${symbol.symbol} to 50 lots ($5,000,000)`);
    }
    
    console.log("All symbol configurations updated successfully!");
  } catch (error) {
    console.error("Error updating max lot sizes:", error);
  }
}

// Run the update function
updateMaxLots()
  .catch(error => {
    console.error("Script error:", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });