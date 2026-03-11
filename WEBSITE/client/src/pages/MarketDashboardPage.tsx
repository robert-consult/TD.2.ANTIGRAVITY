import { useState } from "react";
import { MarketingHeader } from "@/components/MarketingHeader";
import { TickerTape } from "@/modules/tradingview/TickerTape";
import { MarketCard } from "@/modules/tradingview/MarketCard";
import { TradingViewChart } from "@/modules/tradingview/TradingViewChart";
import { MARKET_PAIRS, MarketPair } from "@/modules/tradingview/market-data";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MarketDashboardPage() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [subTab, setSubTab] = useState("all");

  const filteredPairs = MARKET_PAIRS.filter((pair) => {
    const matchesSearch = 
      pair.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      pair.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pair.symbol.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTab = activeTab === "all" || pair.category.toLowerCase() === activeTab.toLowerCase();
    
    const matchesSubTab = subTab === "all" || (pair.region && pair.region.toLowerCase() === subTab.toLowerCase());
    
    return matchesSearch && matchesTab && matchesSubTab;
  });

  const categories = ["All", "Forex", "Stocks", "Indices", "ETFs", "Commodities", "Energy"];
  const stockRegions = ["All", "US", "Europe", "Asia-Pacific"];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <MarketingHeader />
      
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="mb-8 text-center">
            <motion.h1 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl md:text-5xl font-light tracking-tight mb-4 text-foreground"
            >
              Market <span className="font-bold text-primary">Dashboard</span>
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="text-muted-foreground text-lg max-w-2xl mx-auto"
            >
              Real-time global market data across Equities, Indices, ETFs, Commodities and Currencies.
            </motion.p>
          </header>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <TickerTape />
          </motion.div>

          <div className="mt-8 mb-8 space-y-6">
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input 
                type="text" 
                placeholder="Search symbols (e.g., NVDA, Gold, EURUSD)..." 
                className="pl-10 bg-card border-border/50 focus:border-primary/50 transition-colors"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-4 items-center">
              <Tabs defaultValue="all" value={activeTab} className="w-full flex flex-col items-center" onValueChange={(val) => {
                setActiveTab(val);
                if (val !== "stocks") setSubTab("all");
              }}>
                <TabsList className="bg-card border border-border/50 p-1 h-auto flex-wrap justify-center gap-1">
                  {categories.map((cat) => (
                    <TabsTrigger 
                      key={cat} 
                      value={cat.toLowerCase()}
                      className="data-[state=active]:bg-[#4265FC] data-[state=active]:text-white hover:bg-[#4265FC]/20 px-4 py-2 rounded-md transition-all"
                    >
                      {cat}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {activeTab === "stocks" && (
                <Tabs defaultValue="all" value={subTab} className="w-full flex flex-col items-center" onValueChange={setSubTab}>
                  <TabsList className="bg-card/50 border border-border/30 p-1 h-auto flex-wrap justify-center gap-1 scale-90">
                    {stockRegions.map((region) => (
                      <TabsTrigger 
                        key={region} 
                        value={region === "Asia-Pacific" ? "asia" : region.toLowerCase()}
                        className="data-[state=active]:bg-[#4265FC] data-[state=active]:text-white hover:bg-[#4265FC]/20 px-3 py-1.5 rounded-sm text-sm transition-all"
                      >
                        {region}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div 
              key={activeTab + subTab + searchQuery}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            >
              {filteredPairs.length > 0 ? (
                filteredPairs.map((pair, index) => (
                  <motion.div
                    key={pair.symbol}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <MarketCard 
                      {...pair} 
                      onOpen={setSelectedSymbol} 
                    />
                  </motion.div>
                ))
              ) : (
                <div className="col-span-full text-center py-20 text-muted-foreground">
                  <p className="text-lg">No symbols found matching "{searchQuery}"</p>
                  <button 
                    onClick={() => { setSearchQuery(""); setActiveTab("all"); setSubTab("all"); }}
                    className="mt-4 text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          
          <footer className="mt-20 text-center text-xs text-muted-foreground border-t border-border/30 pt-8 mb-8 space-y-2">
            <p>Data provided by TradingView. This dashboard is for informational purposes only.</p>
            <p>© {new Date().getFullYear()} TradeQuip. All rights reserved.</p>
          </footer>
        </div>

        <Dialog open={!!selectedSymbol} onOpenChange={(open) => !open && setSelectedSymbol(null)}>
          <DialogContent className="max-w-[95vw] h-[85vh] p-0 bg-card border-border overflow-hidden sm:max-w-[90vw]">
            <DialogHeader className="absolute top-0 left-0 right-0 z-10 flex flex-row items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
               <DialogTitle className="text-white/90 font-mono pointer-events-auto bg-black/60 px-4 py-1.5 rounded backdrop-blur-md border border-white/10 shadow-lg text-sm md:text-base">
                 {MARKET_PAIRS.find(p => p.symbol === selectedSymbol)?.title || selectedSymbol} 
                 <span className="hidden md:inline text-white/50 mx-2">|</span> 
                 <span className="hidden md:inline text-xs text-white/70 font-sans font-normal">
                   {MARKET_PAIRS.find(p => p.symbol === selectedSymbol)?.desc}
                 </span>
               </DialogTitle>
            </DialogHeader>
            
            {selectedSymbol && (
              <div className="w-full h-full bg-[#131722]">
                <TradingViewChart symbol={selectedSymbol} />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
