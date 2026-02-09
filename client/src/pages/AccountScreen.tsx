import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useAccountSummary } from "@/hooks/use-account-summary";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Wallet, TrendingUp, TrendingDown, PieChart, Activity, AlertTriangle, Lightbulb, Clock, Target, BarChart3, BookOpen, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { MailboxMinitab } from "@/components/Mailbox/MailboxMinitab";
import { useMailboxThreads } from "@/hooks/use-mailbox";

export default function AccountScreen() {
  const sideLabels: Record<string, { label: string }> = {
    BUY: { label: "Buy" },
    SELL: { label: "Sell" },
  };

  const bestSideLabels: Record<string, { label: string }> = {
    BUY: { label: "📈 Long (Buy)" },
    SELL: { label: "📉 Short (Sell)" },
  };

  const getSideLabel = (side: unknown) => {
    const key = String(side ?? "").trim().toUpperCase();
    if (!key) return "—";
    return sideLabels[key]?.label ?? key;
  };

  const getBestSideLabel = (side: unknown) => {
    const key = String(side ?? "").trim().toUpperCase();
    if (!key) return "—";
    return bestSideLabels[key]?.label ?? getSideLabel(key);
  };

  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { summary, isLoading } = useAccountSummary();
  const { data: mailboxSummary } = useMailboxThreads(1, 0);
  const mailboxUnreadCount = Number(mailboxSummary?.unreadCount ?? 0);

  const { data: trades = [] } = useQuery<any[]>({
    queryKey: ["/api/trades"],
    enabled: !!user,
  });

  const closedTrades = trades.filter((t: any) => t.closePrice);
  const getProfit = (t: any) => {
    const v = t?.netProfitUsd ?? t?.profit ?? t?.pnl ?? t?.realizedPnl ?? 0;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const totalProfit = closedTrades.reduce((sum: number, t: any) => sum + getProfit(t), 0);
  const winningTrades = closedTrades.filter((t: any) => getProfit(t) > 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;

  // Trader Insights computation
  const getSymbol = (t: any) => {
    // Handle nested symbol object from trade relation (t.symbol.symbol)
    if (t?.symbol && typeof t.symbol === 'object' && t.symbol.symbol) {
      return String(t.symbol.symbol);
    }
    // Fallback to direct properties if they're strings
    const sym = t?.symbol || t?.instrument || t?.pair || t?.market;
    if (typeof sym === 'string') return sym;
    return "UNKNOWN";
  };

  const getSide = (t: any) => {
    const raw = (t?.side || t?.direction || t?.type || "").toString().toLowerCase();
    if (raw.includes("buy") || raw.includes("long")) return "BUY";
    if (raw.includes("sell") || raw.includes("short")) return "SELL";
    return "UNKNOWN";
  };

  const getOpenTs = (t: any) => {
    const v = t?.openTime ?? t?.entryTime ?? t?.createdAt ?? t?.openedAt ?? null;
    const d = v ? new Date(typeof v === 'number' && v < 10000000000 ? v * 1000 : v) : null;
    return d && !isNaN(d.getTime()) ? d.getTime() : null;
  };

  const getCloseTs = (t: any) => {
    const v = t?.closeTime ?? t?.exitTime ?? t?.updatedAt ?? t?.closedAt ?? null;
    const d = v ? new Date(typeof v === 'number' && v < 10000000000 ? v * 1000 : v) : null;
    return d && !isNaN(d.getTime()) ? d.getTime() : null;
  };

  const holdingBucket = (sec: number) => {
    if (sec <= 60) return "0–1m";
    if (sec <= 5 * 60) return "1–5m";
    if (sec <= 15 * 60) return "5–15m";
    if (sec <= 60 * 60) return "15–60m";
    if (sec <= 4 * 60 * 60) return "1–4h";
    return "4h+";
  };

  const insights = (() => {
    const bySymbol = new Map<string, { profit: number; wins: number; losses: number; trades: number }>();
    const bySide = new Map<string, { profit: number; trades: number; wins: number }>();
    const byHour = new Map<number, { profit: number; trades: number; wins: number }>();
    const byHold = new Map<string, { profit: number; trades: number; wins: number }>();

    for (const t of closedTrades) {
      const profit = getProfit(t);
      const symbol = getSymbol(t);
      const side = getSide(t);
      const openTs = getOpenTs(t);
      const closeTs = getCloseTs(t);

      // By symbol
      const s = bySymbol.get(symbol) || { profit: 0, wins: 0, losses: 0, trades: 0 };
      s.profit += profit;
      s.trades += 1;
      if (profit > 0) s.wins += 1;
      else if (profit < 0) s.losses += 1;
      bySymbol.set(symbol, s);

      // By side/direction
      const sd = bySide.get(side) || { profit: 0, trades: 0, wins: 0 };
      sd.profit += profit;
      sd.trades += 1;
      if (profit > 0) sd.wins += 1;
      bySide.set(side, sd);

      // By hour of entry
      if (openTs) {
        const hr = new Date(openTs).getHours();
        const h = byHour.get(hr) || { profit: 0, trades: 0, wins: 0 };
        h.profit += profit;
        h.trades += 1;
        if (profit > 0) h.wins += 1;
        byHour.set(hr, h);
      }

      // By holding time bucket
      if (openTs && closeTs && closeTs > openTs) {
        const sec = Math.floor((closeTs - openTs) / 1000);
        const bucket = holdingBucket(sec);
        const hb = byHold.get(bucket) || { profit: 0, trades: 0, wins: 0 };
        hb.profit += profit;
        hb.trades += 1;
        if (profit > 0) hb.wins += 1;
        byHold.set(bucket, hb);
      }
    }

    const symbolRank = Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, ...v, winRate: v.trades ? (v.wins / v.trades) * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit);

    const sideRank = Array.from(bySide.entries())
      .map(([side, v]) => ({ side, ...v, winRate: v.trades ? (v.wins / v.trades) * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit);

    const hourRank = Array.from(byHour.entries())
      .map(([hour, v]) => ({ hour, ...v, winRate: v.trades ? (v.wins / v.trades) * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit);

    const holdRank = Array.from(byHold.entries())
      .map(([bucket, v]) => ({ bucket, ...v, winRate: v.trades ? (v.wins / v.trades) * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit);

    return {
      symbolRank,
      sideRank,
      hourRank,
      holdRank,
      topSymbol: symbolRank[0] || null,
      worstSymbol: symbolRank.length > 1 ? symbolRank[symbolRank.length - 1] : null,
      bestSide: sideRank[0] || null,
      bestHour: hourRank[0] || null,
      bestHold: holdRank[0] || null,
    };
  })();

  const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null) return "$0.00";
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="h-full flex flex-col bg-neutral-900 overflow-auto" style={{ containerType: 'inline-size', containerName: 'account' }}>
      <div className="tq-page-header">
        <h1 className="tq-page-title inline-flex items-center gap-2">
          Account
          {mailboxUnreadCount > 0 ? <span className="h-2.5 w-2.5 rounded-full bg-sky-400" title="Unread mailbox messages" /> : null}
        </h1>
      </div>

      <div className="flex-1 p-3 sm:p-6">
        <div className="max-w-4xl">
          <Tabs defaultValue="account" className="space-y-4 sm:space-y-6">
            <TabsList className="bg-neutral-800 border border-gray-700 h-auto p-1 w-full max-w-sm grid grid-cols-2 gap-1">
              <TabsTrigger value="account" className="text-xs sm:text-sm data-[state=active]:bg-neutral-700">
                Account
              </TabsTrigger>
              <TabsTrigger value="mailbox" className="text-xs sm:text-sm data-[state=active]:bg-neutral-700">
                <span className="inline-flex items-center gap-1.5">
                  Mailbox
                  {mailboxUnreadCount > 0 ? <span className="h-2 w-2 rounded-full bg-sky-400" title="Unread mailbox messages" /> : null}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="mailbox" className="mt-0">
              <MailboxMinitab />
            </TabsContent>

            <TabsContent value="account" className="space-y-4 sm:space-y-6 mt-0">
          {/* Stale Pricing Warning Banner */}
          {summary?.pricingStale && (
            <Alert className="bg-yellow-900/30 border-yellow-600">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <AlertDescription className="text-yellow-200">
                P/L and margin values are frozen due to stale or missing price data
                {summary.staleSymbols.length > 0 && (
                  <span> for: {summary.staleSymbols.join(', ')}</span>
                )}. Trading and closing may be blocked until fresh quotes are available.
              </AlertDescription>
            </Alert>
          )}

          <Card className="bg-neutral-800 border-gray-700">
	            <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
	              <CardTitle className="flex items-center gap-2 text-white text-sm sm:text-base">
	                <User className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
	                <span className="hidden sm:inline">Account Information</span>
	                <span className="sm:hidden">Account Info</span>
	              </CardTitle>
	            </CardHeader>
            <CardContent className="px-3 sm:px-6">
              {isLoading ? (
                <Skeleton className="h-6 w-48" />
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-gray-700/50">
                    <span className="text-gray-400 text-xs sm:text-sm">Username</span>
                    <span className="text-white font-medium text-xs sm:text-sm">{user?.username || "-"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-gray-700/50">
                    <span className="text-gray-400 text-xs sm:text-sm">Account Type</span>
                    <span className="text-white font-medium text-xs sm:text-sm">{user?.isAdmin ? "Admin" : "Trader"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-gray-700/50">
                    <span className="text-gray-400 text-xs sm:text-sm">Member Since</span>
                    <span className="text-white font-medium text-xs sm:text-sm">
                      {user?.createdAt
                        ? new Date(
                          typeof user.createdAt === "number" && user.createdAt < 1e12
                            ? user.createdAt * 1000
                            : user.createdAt
                        ).toLocaleDateString()
                        : "-"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 sm:py-2">
                    <span className="text-gray-400 text-xs sm:text-sm">Open Positions</span>
                    <span className="text-white font-medium text-xs sm:text-sm">{summary?.openPositions ?? 0}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid-auto-fit grid-min-18" style={{ containerType: 'inline-size', containerName: 'panel' }}>
            <Card className="bg-neutral-800 border-gray-700">
              <CardContent className="pt-4 px-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-cq-xs text-gray-400">Balance</p>
                    {isLoading ? (
                      <Skeleton className="h-5 w-20 mt-1" />
                    ) : (
                      <p className="price-display text-white">{formatCurrency(summary?.balance)}</p>
                    )}
	                  </div>
	                  <Wallet className="h-6 w-6 text-primary" />
	                </div>
	              </CardContent>
	            </Card>

            <Card className="bg-neutral-800 border-gray-700">
              <CardContent className="pt-4 px-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-cq-xs text-gray-400">Equity</p>
                    {isLoading ? (
                      <Skeleton className="h-5 w-20 mt-1" />
                    ) : (
                      <p className={`price-display ${summary?.pricingStale ? 'text-yellow-400' : 'text-white'}`}>
                        {formatCurrency(summary?.equity)}
                        {summary?.pricingStale && <span className="text-cq-xs ml-1">(stale)</span>}
                      </p>
                    )}
                  </div>
                  <Activity className="h-6 w-6 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-neutral-800 border-gray-700">
              <CardContent className="pt-4 px-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-cq-xs text-gray-400"><span className="cq-hide-narrow">Free </span>Margin</p>
                    {isLoading ? (
                      <Skeleton className="h-5 w-20 mt-1" />
                    ) : (
                      <p className={`price-display ${summary?.pricingStale ? 'text-yellow-400' : 'text-white'}`}>
                        {formatCurrency(summary?.freeMargin)}
                        {summary?.pricingStale && <span className="text-cq-xs ml-1">(stale)</span>}
                      </p>
                    )}
                  </div>
                  <TrendingUp className="h-6 w-6 text-emerald-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-neutral-800 border-gray-700">
              <CardContent className="pt-4 px-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-cq-xs text-gray-400"><span className="cq-hide-narrow">Used </span>Margin</p>
                    {isLoading ? (
                      <Skeleton className="h-5 w-20 mt-1" />
                    ) : (
                      <p className="price-display text-white">{formatCurrency(summary?.usedMargin)}</p>
                    )}
                  </div>
                  <TrendingDown className="h-6 w-6 text-orange-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-neutral-800 border-gray-700">
              <CardContent className="pt-4 px-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-cq-xs text-gray-400"><span className="cq-hide-narrow">Floating </span>P/L</p>
                    {isLoading ? (
                      <Skeleton className="h-5 w-20 mt-1" />
                    ) : (
                      <p className={`price-display ${summary?.pricingStale
                        ? 'text-yellow-400'
                        : (summary?.floatingPnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'
                        }`}>
                        {formatCurrency(summary?.floatingPnl)}
                        {summary?.pricingStale && <span className="text-cq-xs ml-1">(stale)</span>}
                      </p>
                    )}
                  </div>
                  <PieChart className="h-6 w-6 text-purple-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-neutral-800 border-gray-700">
              <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] sm:text-xs md:text-sm text-gray-400"><span className="hidden sm:inline">Margin </span>Level</p>
                    {isLoading ? (
                      <Skeleton className="h-5 sm:h-7 w-20 sm:w-24 mt-1" />
                    ) : (
                      <p className="text-base sm:text-lg md:text-xl font-bold text-white">
                        {summary?.marginLevel !== null && summary?.marginLevel !== undefined
                          ? `${summary.marginLevel.toFixed(2)}%`
                          : "-"}
                      </p>
                    )}
                  </div>
                  <Activity className="h-6 w-6 sm:h-8 sm:w-8 text-cyan-400" />
                </div>
              </CardContent>
            </Card>
          </div>

	          <Card className="bg-neutral-800 border-gray-700">
	            <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
	              <CardTitle className="flex items-center gap-2 text-white text-sm sm:text-base">
	                <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
	                <span className="hidden sm:inline">Trading Statistics</span>
	                <span className="sm:hidden">Stats</span>
	              </CardTitle>
	            </CardHeader>
            <CardContent className="px-3 sm:px-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                <div className="text-center p-2 sm:p-card bg-neutral-700/50 rounded-lg">
                  <p className="text-lg sm:text-xl md:text-2xl font-bold text-white">{closedTrades.length}</p>
                  <p className="text-[10px] sm:text-xs md:text-sm text-gray-400">Total Trades</p>
                </div>
                <div className="text-center p-2 sm:p-card bg-neutral-700/50 rounded-lg">
                  <p className="text-lg sm:text-xl md:text-2xl font-bold text-green-500">{winningTrades.length}</p>
                  <p className="text-[10px] sm:text-xs md:text-sm text-gray-400">Winning</p>
                </div>
                <div className="text-center p-2 sm:p-card bg-neutral-700/50 rounded-lg">
                  <p className="text-lg sm:text-xl md:text-2xl font-bold text-red-500">{closedTrades.length - winningTrades.length}</p>
                  <p className="text-[10px] sm:text-xs md:text-sm text-gray-400">Losing</p>
                </div>
	                <div className="text-center p-2 sm:p-card bg-neutral-700/50 rounded-lg">
	                  <p className="text-lg sm:text-xl md:text-2xl font-bold text-primary">{winRate.toFixed(1)}%</p>
	                  <p className="text-[10px] sm:text-xs md:text-sm text-gray-400">Win Rate</p>
	                </div>
              </div>
              <div className="mt-3 sm:mt-4 p-2 sm:p-card bg-neutral-700/50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-xs sm:text-sm"><span className="hidden sm:inline">Total </span>Realized P/L</span>
                  <span className={`text-base sm:text-lg md:text-xl font-bold ${totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {formatCurrency(totalProfit)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Trader Insights Card */}
          <Card className="bg-neutral-800 border-gray-700">
            <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
              <CardTitle className="flex items-center gap-2 text-white text-sm sm:text-base">
                <Lightbulb className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400" />
                <span className="hidden sm:inline">Trader Insights</span>
                <span className="sm:hidden">Insights</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6">
              {closedTrades.length === 0 ? (
                <div className="text-xs sm:text-sm text-gray-400 p-2 sm:p-card text-center">
                  No closed trades yet. Insights will appear once you have realized P/L history.
                </div>
              ) : closedTrades.length < 5 ? (
                <div className="text-xs sm:text-sm text-gray-400 p-2 sm:p-card text-center">
                  Need at least 5 closed trades for meaningful insights. You have {closedTrades.length} so far.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Summary Highlights */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Best Instrument */}
                    <div className="bg-neutral-700/50 rounded-lg p-card">
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="h-4 w-4 text-green-400" />
                        <span className="text-sm text-gray-400">Most Profitable Instrument</span>
                      </div>
                      {insights.topSymbol ? (
                        <div>
                          <div className="text-lg font-bold text-white">{insights.topSymbol.symbol}</div>
                          <div className="flex gap-3 text-xs text-gray-400 mt-1">
                            <span className={insights.topSymbol.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {formatCurrency(insights.topSymbol.profit)}
                            </span>
                            <span>{insights.topSymbol.trades} trades</span>
                            <span>{insights.topSymbol.winRate.toFixed(0)}% win</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-500">Insufficient data</div>
                      )}
                    </div>

                    {/* Worst Instrument */}
                    <div className="bg-neutral-700/50 rounded-lg p-card">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                        <span className="text-sm text-gray-400">Least Profitable Instrument</span>
                      </div>
                      {insights.worstSymbol && insights.worstSymbol.profit < 0 ? (
                        <div>
                          <div className="text-lg font-bold text-white">{insights.worstSymbol.symbol}</div>
                          <div className="flex gap-3 text-xs text-gray-400 mt-1">
                            <span className="text-red-400">{formatCurrency(insights.worstSymbol.profit)}</span>
                            <span>{insights.worstSymbol.trades} trades</span>
                            <span>{insights.worstSymbol.winRate.toFixed(0)}% win</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-500 text-sm">No losing instruments</div>
                      )}
                    </div>

                    {/* Best Direction */}
	                    <div className="bg-neutral-700/50 rounded-lg p-card">
	                      <div className="flex items-center gap-2 mb-2">
	                        <BarChart3 className="h-4 w-4 text-primary" />
	                        <span className="text-sm text-gray-400">Best Direction</span>
	                      </div>
	                      {insights.bestSide ? (
                        <div>
                          <div className="text-lg font-bold text-white">
                            {getBestSideLabel(insights.bestSide.side)}
                          </div>
                          <div className="flex gap-3 text-xs text-gray-400 mt-1">
                            <span className={insights.bestSide.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {formatCurrency(insights.bestSide.profit)}
                            </span>
                            <span>{insights.bestSide.trades} trades</span>
                            <span>{insights.bestSide.winRate.toFixed(0)}% win</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-500">Insufficient data</div>
                      )}
                    </div>

                    {/* Best Hour */}
                    <div className="bg-neutral-700/50 rounded-lg p-card">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-4 w-4 text-purple-400" />
                        <span className="text-sm text-gray-400">Best Trading Hour</span>
                      </div>
                      {insights.bestHour ? (
                        <div>
                          <div className="text-lg font-bold text-white">
                            {String(insights.bestHour.hour).padStart(2, '0')}:00 - {String((insights.bestHour.hour + 1) % 24).padStart(2, '0')}:00
                          </div>
                          <div className="flex gap-3 text-xs text-gray-400 mt-1">
                            <span className={insights.bestHour.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {formatCurrency(insights.bestHour.profit)}
                            </span>
                            <span>{insights.bestHour.trades} trades</span>
                            <span>{insights.bestHour.winRate.toFixed(0)}% win</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-500">Insufficient data</div>
                      )}
                    </div>
                  </div>

                  {/* Optimal Holding Time */}
                  <div className="bg-gradient-to-r from-amber-900/30 to-neutral-700/50 rounded-lg p-card border border-amber-600/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb className="h-4 w-4 text-amber-400" />
                      <span className="text-sm text-amber-300 font-medium">Optimal Holding Time</span>
                    </div>
                    {insights.bestHold ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xl font-bold text-white">{insights.bestHold.bucket}</div>
                          <div className="text-xs text-gray-400 mt-1">
                            Trades held for this duration have the highest profitability
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-bold ${insights.bestHold.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatCurrency(insights.bestHold.profit)}
                          </div>
                          <div className="text-xs text-gray-400">
                            {insights.bestHold.trades} trades · {insights.bestHold.winRate.toFixed(0)}% win rate
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-500">Insufficient data to determine optimal holding time</div>
                    )}
                  </div>

                  {/* All Instruments Breakdown */}
                  {insights.symbolRank.length > 2 && (
                    <div className="mt-4">
                      <div className="text-sm text-gray-400 mb-2">All Instruments Performance</div>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {insights.symbolRank.map((item, idx) => (
                          <div key={item.symbol} className="flex items-center justify-between text-sm bg-neutral-700/30 rounded px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500 w-5">{idx + 1}.</span>
                              <span className="text-white font-medium">{item.symbol}</span>
                            </div>
                            <div className="flex gap-4 text-xs">
                              <span className={item.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {formatCurrency(item.profit)}
                              </span>
                              <span className="text-gray-400">{item.trades} trades</span>
                              <span className="text-gray-400">{item.winRate.toFixed(0)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Trading Journal Quick Access */}
          <Card className="bg-gradient-to-r from-emerald-900/40 to-neutral-800 border-emerald-600/30 cursor-pointer hover:border-emerald-500/50 transition-colors" onClick={() => navigate("/journal")}>
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-500/20 rounded-lg">
                    <BookOpen className="h-6 w-6 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Trading Journal</h3>
                    <p className="text-sm text-gray-400">
                      Document your trades, emotions, and lessons learned
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-400" />
              </div>
            </CardContent>
          </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
