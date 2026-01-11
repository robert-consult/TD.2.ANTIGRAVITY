import { useState } from "react";
import { Header } from "@/components/Header";
import { MobileNavigation, SideNavigation } from "@/components/Navigation";
import { AppShell } from "@/components/layout/AppShell";
import QuotesScreen from "./QuotesScreen";
import ChartScreen from "./ChartScreen";
import TradeScreen from "./TradeScreen";
import HistoryScreen from "./HistoryScreen";
import LeaderboardScreen from "./LeaderboardScreen";
import AccountScreen from "./AccountScreen";
import { useQuotes } from "@/hooks/use-quotes";
import { useAuth } from "@/hooks/use-auth";
import axios from "axios";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("quotes");
  const [selectedSymbol, setSelectedSymbol] = useState("USDJPY");
  const { quotes } = useQuotes();
  const { user, checkAuth } = useAuth();
  const [adminPromotion, setAdminPromotion] = useState({
    isPromoting: false,
    success: false,
    error: ""
  });

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
    setSelectedSymbol(symbol);
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
      {activeTab === "quotes" && <QuotesScreen onSelectSymbol={handleSelectSymbol} />}

      {activeTab === "chart" && <ChartScreen selectedSymbol={selectedSymbol} />}

      {activeTab === "trade" && (
        <TradeScreen selectedSymbol={selectedSymbol} currentPrice={currentQuote?.price} />
      )}

      {activeTab === "history" && <HistoryScreen />}

      {activeTab === "leaderboard" && <LeaderboardScreen />}

      {activeTab === "account" && <AccountScreen />}
    </AppShell>
  );
}
