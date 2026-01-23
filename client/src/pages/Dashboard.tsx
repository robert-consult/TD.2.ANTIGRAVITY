import { Suspense, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { MobileNavigation, SideNavigation } from "@/components/Navigation";
import { AppShell } from "@/components/layout/AppShell";
import { useQuotes } from "@/hooks/use-quotes";
import { useAuth } from "@/hooks/use-auth";
import axios from "axios";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
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
  const { user, checkAuth } = useAuth();
  const [adminPromotion, setAdminPromotion] = useState({
    isPromoting: false,
    success: false,
    error: ""
  });

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

  // Promote current user to admin (development helper)
  const promoteToAdmin = async () => {
    if (!user) return;
    
    setAdminPromotion({
      isPromoting: true,
      success: false,
      error: ""
    });
    
    try {
      await axios.post('/api/promote-to-admin', { userId: user.id });
      setAdminPromotion({
        isPromoting: false,
        success: true,
        error: ""
      });
      // Refresh authentication to update admin status
      await checkAuth();
    } catch (error) {
      setAdminPromotion({
        isPromoting: false,
        success: false,
        error: "Failed to promote to admin"
      });
    }
  };

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
          <Header />

          {/* Admin Quick Access */}
          {user && (
            <div className="bg-neutral-850 px-gutter py-2 flex items-center justify-between border-b border-gray-800 shrink-0">
              <div className="flex items-center space-x-2 min-w-0">
                {user.isAdmin ? (
                  <Link href="/admin">
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-blue-900 hover:bg-blue-800 text-white border-blue-700"
                    >
                      Admin Dashboard
                    </Button>
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={promoteToAdmin}
                    disabled={adminPromotion.isPromoting}
                    className="bg-neutral-700 hover:bg-neutral-600 text-gray-300"
                  >
                    {adminPromotion.isPromoting ? "Processing..." : "Enable Admin Mode"}
                  </Button>
                )}

                {adminPromotion.success && (
                  <span className="text-green-500 text-sm truncate">
                    Admin access granted! You can now visit the Admin Dashboard.
                  </span>
                )}

                {adminPromotion.error && (
                  <span className="text-red-500 text-sm truncate">{adminPromotion.error}</span>
                )}
              </div>

              <div className="text-sm text-gray-400 shrink-0">
                Balance:{" "}
                <span className="font-semibold text-white">${user.balance}</span>
              </div>
            </div>
          )}
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
