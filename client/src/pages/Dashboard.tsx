import { Suspense, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Header } from "@/components/Header";
import { MobileNavigation, SideNavigation } from "@/components/Navigation";
import { AppShell } from "@/components/layout/AppShell";
import { useQuotes } from "@/hooks/use-quotes";
import { useQuery } from "@tanstack/react-query";
import { lazyWithPing } from "@/lib/lazyWithPing";
import { StaleDataBadge } from "@/components/StaleDataBadge";
import { useStaleData } from "@/lib/staleData";

const QuotesScreen = lazyWithPing(() => import("./QuotesScreen"));
const ChartScreen = lazyWithPing(() => import("./ChartScreen"));
const TradeScreen = lazyWithPing(() => import("./TradeScreen"));
const HistoryScreen = lazyWithPing(() => import("./HistoryScreen"));
const LeaderboardScreen = lazyWithPing(() => import("./LeaderboardScreen"));
const AccountScreen = lazyWithPing(() => import("./AccountScreen"));

function DashboardLoadingFallback({ activeTab }: { activeTab: string }) {
  const tabLabelMap: Record<string, string> = {
    quotes: "quotes",
    chart: "chart",
    trade: "trade",
    history: "history",
    leaderboard: "leaderboard",
    account: "account",
  };
  const label = tabLabelMap[activeTab] ?? "panel";

  return (
    <div className="px-gutter py-4">
      <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-gray-400">
        <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
        <span>Loading {label}…</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("quotes");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [, startTransition] = useTransition();
  const { quotes } = useQuotes();
  const hasHydratedDashboardData = useStaleData("/api/account/summary");

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

  const setActiveTabDeferred = useCallback((nextTab: string) => {
    startTransition(() => {
      setActiveTab(nextTab);
    });
  }, [startTransition]);

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
      setActiveTabDeferred("chart");
    }
  };

  return (
    <AppShell
      className="tq-dashboard-shell"
      contentClassName="tq-dashboard-main"
      header={
        <>
          <Header showBalance />
          {hasHydratedDashboardData ? (
            <div className="px-gutter pb-2">
              <StaleDataBadge />
            </div>
          ) : null}
        </>
      }
      mobileNav={<MobileNavigation activeTab={activeTab} setActiveTab={setActiveTabDeferred} />}
      sidebar={<SideNavigation activeTab={activeTab} setActiveTab={setActiveTabDeferred} />}
    >
      <Suspense fallback={<DashboardLoadingFallback activeTab={activeTab} />}>
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
