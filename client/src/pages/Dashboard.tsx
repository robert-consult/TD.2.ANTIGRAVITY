import { Suspense, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { MobileNavigation, SideNavigation } from "@/components/Navigation";
import { AppShell } from "@/components/layout/AppShell";
import { useQuotes } from "@/hooks/use-quotes";
import { useQuery } from "@tanstack/react-query";
import { lazyWithPing } from "@/lib/lazyWithPing";

const QuotesScreen = lazyWithPing(() => import("./QuotesScreen"));
const ChartScreen = lazyWithPing(() => import("./ChartScreen"));
const TradeScreen = lazyWithPing(() => import("./TradeScreen"));
const HistoryScreen = lazyWithPing(() => import("./HistoryScreen"));
const LeaderboardScreen = lazyWithPing(() => import("./LeaderboardScreen"));
const AccountScreen = lazyWithPing(() => import("./AccountScreen"));

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("quotes");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const { quotes } = useQuotes();

  const { data: symbols = [] } = useQuery<Array<{ symbol: string }>>({
    queryKey: ["/api/config/symbols"],
  });

  const activeSymbols = useMemo(
    () =>
      (symbols || [])
        .map((s) => String(s.symbol || "").toUpperCase())
        .filter(Boolean),
    [symbols],
  );

  useEffect(() => {
    if (!activeSymbols.length) {
      setSelectedSymbol("");
      return;
    }
    const defaultSymbol = activeSymbols.includes("USDJPY") ? "USDJPY" : activeSymbols[0];
    if (!selectedSymbol || !activeSymbols.includes(selectedSymbol)) {
      setSelectedSymbol(defaultSymbol);
    }
  }, [activeSymbols, selectedSymbol]);

  // Find the current price for the selected symbol
  const currentQuote = quotes?.find(
    (quote) => quote.symbol === selectedSymbol
  );

  const handleSelectSymbol = (symbol: string) => {
    const next = String(symbol || "").toUpperCase();
    if (next && activeSymbols.includes(next)) {
      setSelectedSymbol(next);
    }
    // If we're not on chart or trade tab, switch to chart when selecting a symbol
    if (activeTab !== "chart" && activeTab !== "trade") {
      setActiveTab("chart");
    }
  };

  return (
    <AppShell
      header={
        <>
          <Header showBalance />
        </>
      }
      mobileNav={<MobileNavigation activeTab={activeTab} setActiveTab={setActiveTab} />}
      sidebar={<SideNavigation activeTab={activeTab} setActiveTab={setActiveTab} />}
    >
      <Suspense fallback={<div className="px-gutter py-4 text-sm text-muted-foreground">Loading…</div>}>
        {activeTab === "quotes" && <QuotesScreen onSelectSymbol={handleSelectSymbol} />}

        {(activeTab === "chart" || activeTab === "trade") && !selectedSymbol && (
          <div className="px-gutter py-6 text-sm text-muted-foreground">
            No instruments are enabled right now. Please contact support or an admin.
          </div>
        )}

        {activeTab === "chart" && selectedSymbol && <ChartScreen selectedSymbol={selectedSymbol} />}

        {activeTab === "trade" && (
          selectedSymbol ? <TradeScreen selectedSymbol={selectedSymbol} currentPrice={currentQuote?.price} /> : null
        )}

        {activeTab === "history" && <HistoryScreen />}

        {activeTab === "leaderboard" && <LeaderboardScreen />}

        {activeTab === "account" && <AccountScreen />}
      </Suspense>
    </AppShell>
  );
}
