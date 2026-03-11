import { useLocation } from "wouter";
import { Link } from "wouter";
import { MarketingHeader } from "@/components/MarketingHeader";
import { Button } from "@/components/ui/button";
import { TickerTape } from "@/modules/tradingview/TickerTape";
import { MarketCard } from "@/modules/tradingview/MarketCard";
import { MARKET_PAIRS, MarketPair } from "@/modules/tradingview/market-data";
import { APP_CONFIG } from "@/lib/app-config";
import { TrendingUp, Trophy, BarChart3, Flame, BookOpen, Target } from "lucide-react";

export default function HomePage() {
  const [, navigate] = useLocation();

  const featuredPairs: MarketPair[] = MARKET_PAIRS.slice(0, 8);

  const handleOpenSymbol = (symbol: string) => {
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="w-full py-10 md:py-16 lg:py-20 bg-card border-b">
          <div className="container mx-auto px-4 md:px-6 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold uppercase tracking-wide text-primary">
                Free Audition • No Prop Fees • Real Capital
              </div>
              <h1 className="text-3xl sm:text-4xl xl:text-5xl font-bold tracking-tight text-foreground">
                Elevate Your Trading Game with TradeQuip
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-xl">
                Track your trades, follow a simple rule set, and climb a live leaderboard. 
                The best performers don't buy prop accounts — they get invited to manage real 
                capital with a baseline payout and performance commissions. Trade free, prove it, and get hired.
              </p>

              <div className="flex flex-wrap gap-3">
                <a href={APP_CONFIG.signupUrl}>
                  <Button 
                    size="lg" 
                    title="Create a free account. No prop fee, no challenge purchase."
                    className="bg-[#01D8C1] hover:bg-[#00BFA9] text-black border-none"
                  >
                    Start Free Audition
                  </Button>
                </a>
                <a href={APP_CONFIG.loginUrl}>
                  <Button 
                    size="lg" 
                    className="bg-[#2BFF88] hover:bg-[#1FD86C] text-[#041016] border-none"
                  >
                    Login &amp; Trade
                  </Button>
                </a>
                <Link href="/dashboard">
                  <Button 
                    size="lg" 
                    className="hidden md:inline-flex bg-[#2745D9] hover:bg-[#1a30a8] text-white border-none"
                  >
                    Browse Market Intel
                  </Button>
                </Link>
              </div>
              <p className="text-xs text-muted-foreground">
                Already registered? Log in and keep building your hiring track record.
              </p>
            </div>

            <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl shadow-xl p-4 space-y-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Live market snapshot
              </p>
              <TickerTape />
              <div className="grid grid-cols-2 gap-3 pt-2 max-h-[260px] overflow-y-auto">
                {featuredPairs.map((p) => (
                  <MarketCard
                    key={p.symbol}
                    symbol={p.symbol}
                    title={p.title}
                    desc={p.desc}
                    onOpen={handleOpenSymbol}
                  />
                ))}
              </div>
              <div className="flex justify-end">
                <Link href="/dashboard">
                  <Button 
                    size="sm" 
                    className="bg-[#2745D9] hover:bg-[#1a30a8] text-white border-none"
                  >
                    Open full dashboard
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Key Features Section */}
        <section className="container mx-auto px-4 py-16 md:px-6">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">Key Features</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Your path from free audition to managing real capital.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {/* Trade Tracking */}
            <div className="text-center p-6 rounded-xl border bg-card">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Realtime Trade Tracking</h3>
              <p className="text-sm text-muted-foreground">
                Log every trade live: P&L updates and comprehensive performance metrics — 
                entries, exits, size, and instrument. Your virtual track record and rule-following 
                become your CV for real capital, not how many paid challenges you've taken.
              </p>
            </div>
            
            {/* Leaderboard */}
            <div className="text-center p-6 rounded-xl border bg-card">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <Trophy className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Leaderboard</h3>
              <p className="text-sm text-muted-foreground">
                Compete in a transparent, live leaderboard that highlights consistency, 
                risk discipline, and P&L — not gambling. This is our short-list for 
                selecting traders to manage real money.
              </p>
            </div>
            
            {/* Performance Insights */}
            <div className="text-center p-6 rounded-xl border bg-card">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Performance Insights</h3>
              <p className="text-sm text-muted-foreground">
                See your performance the way a fund would: win rate, drawdown behavior, 
                and rule adherence. Use these insights to tighten your edge and qualify 
                for capital allocation opportunities.
              </p>
            </div>
          </div>
        </section>

        {/* Analyze / Learn / Compete Strip */}
        <section className="bg-card border-y py-16">
          <div className="container mx-auto px-4 md:px-6">
            <div className="grid md:grid-cols-3 gap-8">
              {/* Analyze - The Forge */}
              <div className="p-6 rounded-xl bg-background border">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                    <Flame className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Analyze</h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">The Forge</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Access global markets with TradingView-powered charts and real-time data. 
                  Watch FX, Indices, Energy, Commodities, Equities, &amp; ETFs in real time so 
                  every trade in your track record is informed, not random.
                </p>
              </div>

              {/* Learn - The Wave */}
              <div className="p-6 rounded-xl bg-background border">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Learn</h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">The Wave</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Education that's built around the exact rule set and instruments you'll 
                  trade here — so what you learn is what you'll actually be judged on when 
                  we look at your performance.
                </p>
              </div>

              {/* Compete - The Goal */}
              <div className="p-6 rounded-xl bg-background border">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <Target className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Compete</h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">The Goal</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Trade in a live environment, respect the rules, and climb the leaderboard. 
                  The top, consistent traders are invited to manage real money with a baseline 
                  payout and performance commissions — no prop account purchase, ever.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card py-8">
        <div className="container mx-auto px-4 md:px-6 text-center text-sm text-muted-foreground space-y-2">
          <p>Trading for this website is purely for research and training purposes only. Any &amp; all trading is purely virtual unless stated otherwise.</p>
          <p className="text-xs">© {new Date().getFullYear()} TradeQuip. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
