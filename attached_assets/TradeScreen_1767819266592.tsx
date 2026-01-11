import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useEffect } from "react";
import parseDate from "../utils/parseDate";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useQuotes } from "@/hooks/use-quotes";
import { useTrades } from "@/hooks/use-trades";
import { useAccountSummary } from "@/hooks/use-account-summary";
import { usePendingOrders } from "@/hooks/usePendingOrders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Table, 
  TableHeader, 
  TableRow, 
  TableHead, 
  TableBody, 
  TableCell 
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { EditTradeModal } from "@/components/EditTradeModal";
import { Pencil, X, Zap, Layers, AlertTriangle } from "lucide-react";

interface TradeScreenProps {
  selectedSymbol: string;
  currentPrice?: number;
}

const tradeFormSchema = z.object({
  lots: z.string().refine(
    (val) => !isNaN(Number(val)) && Number(val) >= 1 && Number(val) <= 50 && Number.isInteger(Number(val)), {
    message: "Lots must be a whole number between 1 and 50",
  }),
  takeProfit: z.string().optional(),
  stopLoss: z.string().optional(),
  limitPrice: z.string().optional(),
  stopPrice: z.string().optional(),
});

type TradeFormValues = z.infer<typeof tradeFormSchema>;

export default function TradeScreen({ selectedSymbol, currentPrice }: TradeScreenProps) {
  const [orderType, setOrderType] = useState<string>("Market");
  const [tradeDirection, setTradeDirection] = useState<"BUY" | "SELL" | null>(null);
  const [activeTab, setActiveTab] = useState("place-order");
  const [editingTrade, setEditingTrade] = useState<any>(null);
  const [closingTradeId, setClosingTradeId] = useState<number | null>(null);
  const [pendingSide, setPendingSide] = useState<"BUY" | "SELL">("BUY");
  const [autoEntry, setAutoEntry] = useState(true);
  const [autoTp, setAutoTp] = useState(true);
  const [autoSl, setAutoSl] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { quotes } = useQuotes();
  const { openTrades = [], isLoadingOpenTrades, closeTrade } = useTrades();
  const { summary: accountSummary, isLoading: isLoadingAccountSummary } = useAccountSummary();
  const { pendingOrders = [], isLoading: isLoadingPending, cancelOrder } = usePendingOrders();

  // Define symbol config type
  interface SymbolConfig {
    id: number;
    symbol: string;
    name: string;
    baseCurrency?: string;
    quoteCurrency?: string;
    spread?: number;
    minSpreadPips: number;
    enabled: boolean;
    minLot: number;
    maxLot: number;
  }
  
  // Define trade type
  interface Trade {
    id: number;
    symbolId: number;
    userId: number;
    type: 'BUY' | 'SELL';
    orderType: string;
    status: string;
    size: number;
    lots: number;
    openPrice: number;
    closePrice: number | null;
    profit: string | null;
    takeProfit: number | null;
    stopLoss: number | null;
    limitPrice: number | null;
    stopPrice: number | null;
    createdAt: Date | string | number;
    updatedAt: Date | string | number;
    closedAt: Date | string | number | null;
    openedAt?: Date | string | number | null;
    executedAt?: Date | string | number | null;
  }
  
  // Get selected symbol data
  const { data: symbols = [] } = useQuery<SymbolConfig[]>({
    queryKey: ["/api/config/symbols"],
    initialData: [],
  });

  const selectedSymbolConfig = symbols.find(
    (s) => s.symbol === selectedSymbol
  );

  const currentQuote = quotes?.find(q => q.symbol === selectedSymbol);
  
  // Calculate bid/ask prices with minimum 2 pip spread (moved early for useEffect dependencies)
  const minSpreadPips = selectedSymbolConfig?.minSpreadPips || 2.0;
  const pipFactor = selectedSymbol?.includes("JPY") ? 0.01 : 0.0001;
  const minSpread = minSpreadPips * pipFactor; 
  
  const realSpread = currentQuote?.bid && currentQuote?.ask ? 
    Math.abs(currentQuote.ask - currentQuote.bid) : 0;
  
  let bidPrice: number | undefined, askPrice: number | undefined, spread: number;
  
  if (currentQuote?.bid && currentQuote?.ask && realSpread >= minSpread) {
    bidPrice = currentQuote.bid;
    askPrice = currentQuote.ask;
    spread = realSpread;
  } else if (currentPrice) {
    spread = minSpread;
    askPrice = currentPrice;
    bidPrice = currentPrice - spread;
  } else {
    bidPrice = undefined;
    askPrice = undefined;
    spread = minSpread;
  }

  // --- App-grade order/target styling + validation (TP/SL wrong-side warnings) ---
  const showTargetValidation = true;

  const toFiniteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const formatPx = (value: unknown, symbol: string): string => {
    const n = toFiniteNumber(value);
    if (n === null) return "-";
    return n.toFixed(symbol.includes("JPY") ? 2 : 4);
  };

  const orderTypePillClass = (orderType: unknown): string => {
    const t = String(orderType ?? "").trim().toLowerCase();
    if (t === "stop") return "text-amber-300 bg-amber-500/10 border-amber-500/20";
    if (t === "limit") return "text-sky-300 bg-sky-500/10 border-sky-500/20";
    if (t === "market") return "text-violet-300 bg-violet-500/10 border-violet-500/20";
    if (t === "stoplimit" || t === "stop-limit" || t === "stop limit")
      return "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20";
    return "text-gray-300 bg-gray-500/10 border-gray-500/20";
  };

  const targetPillClassBase = (kind: "TP" | "SL"): string =>
    kind === "TP"
      ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
      : "text-rose-300 bg-rose-500/10 border-rose-500/20";

  const invalidTargetPillClass = "text-amber-200 bg-amber-500/10 border-amber-500/30";

  const isTargetValid = (
    side: "BUY" | "SELL",
    entry: number | null,
    target: number | null,
    kind: "TP" | "SL"
  ): boolean | null => {
    if (entry === null || target === null) return null;
    if (side === "BUY") {
      return kind === "TP" ? target > entry : target < entry;
    }
    return kind === "TP" ? target < entry : target > entry;
  };

  const targetHint = (side: "BUY" | "SELL", kind: "TP" | "SL"): string => {
    if (side === "BUY") {
      return kind === "TP"
        ? "Warning: For BUY, TP should be above entry."
        : "Warning: For BUY, SL should be below entry.";
    }
    return kind === "TP"
      ? "Warning: For SELL, TP should be below entry."
      : "Warning: For SELL, SL should be above entry.";
  };

  const renderTargetPill = (
    kind: "TP" | "SL",
    rawValue: unknown,
    symbol: string,
    side: "BUY" | "SELL",
    entry: number | null
  ) => {
    const v = toFiniteNumber(rawValue);
    if (v === null) return <span className="text-gray-500">-</span>;

    const valid = showTargetValidation ? isTargetValid(side, entry, v, kind) : null;
    const cls = valid === false ? invalidTargetPillClass : targetPillClassBase(kind);

    return (
      <span
        title={valid === false ? targetHint(side, kind) : undefined}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs tabular-nums ${cls}`}
      >
        {valid === false ? <AlertTriangle className="h-3 w-3" /> : null}
        {formatPx(v, symbol)}
      </span>
    );
  };

  const orderTypeHelp = (t: string) => {
    switch (t) {
      case "stop":
        return "Stop (trigger): Executes when market reaches your stop price. Commonly used for breakout entries.";
      case "limit":
        return "Limit (passive): Executes at your limit price or better. Commonly used for pullback entries.";
      default:
        return "Order mechanism (Stop/Limit).";
    }
  };

  const editIconButtonClass =
    "border-cyan-500/50 bg-cyan-500/30 hover:bg-cyan-500/40 hover:border-cyan-500/70 text-cyan-200 [&_svg]:text-cyan-300";

  // Form setup
  const form = useForm<TradeFormValues>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: {
      lots: "1", // Default to 1 lot
      takeProfit: "",
      stopLoss: "",
      limitPrice: "",
      stopPrice: "",
    },
  });

  // Reset form when symbol changes
  useEffect(() => {
    form.reset({
      lots: "1", // Default to 1 lot
      takeProfit: "",
      stopLoss: "",
      limitPrice: "",
      stopPrice: "",
    });
  }, [selectedSymbol, form]);

  // Reset auto-tracking when order type or pendingSide changes
  useEffect(() => {
    setAutoEntry(true);
    setAutoTp(true);
    setAutoSl(true);
  }, [orderType, pendingSide]);

  // Auto-suggest entry/TP/SL prices for pending orders (10 pips from market)
  useEffect(() => {
    if (orderType === "Market" || !askPrice || !bidPrice) return;
    const pip = selectedSymbol.includes("JPY") ? 0.01 : 0.0001;
    const decimals = selectedSymbol.includes("JPY") ? 3 : 5;
    
    if (orderType === "Limit" && autoEntry) {
      const price = pendingSide === "BUY" ? (askPrice - 10 * pip) : (bidPrice + 10 * pip);
      form.setValue("limitPrice", price.toFixed(decimals));
    }
    if (orderType === "Stop" && autoEntry) {
      const price = pendingSide === "BUY" ? (askPrice + 10 * pip) : (bidPrice - 10 * pip);
      form.setValue("stopPrice", price.toFixed(decimals));
    }
    const entryStr = orderType === "Limit" ? form.getValues("limitPrice") : form.getValues("stopPrice");
    const entry = parseFloat(entryStr || "0");
    if (entry > 0) {
      if (autoTp) {
        const tp = pendingSide === "BUY" ? entry + 10 * pip : entry - 10 * pip;
        form.setValue("takeProfit", tp.toFixed(decimals));
      }
      if (autoSl) {
        const sl = pendingSide === "BUY" ? entry - 10 * pip : entry + 10 * pip;
        form.setValue("stopLoss", sl.toFixed(decimals));
      }
    }
  }, [askPrice, bidPrice, orderType, pendingSide, autoEntry, autoTp, autoSl, selectedSymbol, form]);

  // Execute trade mutation
  const executeTrade = useMutation({
    mutationFn: async (data: {
      symbolId: number;
      type: "BUY" | "SELL";
      orderType: string;
      lots: number;
      openPrice: number;
      takeProfit?: number;
      stopLoss?: number;
      limitPrice?: number;
      stopPrice?: number;
    }) => {
      return apiRequest("POST", "/api/trades", data);
    },
    onSuccess: () => {
      // ✅ Ensure both history and open positions refresh
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/current-user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
      
      toast({
        title: "Trade Executed",
        description: `Successfully placed a ${tradeDirection} order for ${selectedSymbol}`,
      });
      
      // Reset form and direction
      form.reset({
        lots: "1", // Default to 1 lot
        takeProfit: "",
        stopLoss: "",
        limitPrice: "",
        stopPrice: "",
      });
      setTradeDirection(null);
      
      // Show the active positions tab to see the new trade
      setActiveTab("active-positions");
    },
    onError: (error) => {
      toast({
        title: "Trade Failed",
        description: error.message || "Failed to execute trade",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: TradeFormValues) => {
    if (!tradeDirection || !selectedSymbolConfig) {
      toast({
        title: "Trade Error",
        description: "Missing required trade information",
        variant: "destructive",
      });
      return;
    }

    const lots = Number(values.lots);
    const takeProfit = values.takeProfit ? Number(values.takeProfit) : undefined;
    const stopLoss = values.stopLoss ? Number(values.stopLoss) : undefined;
    
    // Handle different order types
    let openPrice: number;
    
    switch (orderType) {
      case "Market":
        if (!currentPrice) {
          toast({
            title: "Trade Error",
            description: "Current price is not available for market order",
            variant: "destructive",
          });
          return;
        }
        openPrice = currentPrice;
        break;
        
      case "Limit":
        if (!values.limitPrice || isNaN(Number(values.limitPrice))) {
          toast({
            title: "Trade Error",
            description: "Please enter a valid limit price",
            variant: "destructive",
          });
          return;
        }
        openPrice = Number(values.limitPrice);
        break;
        
      case "Stop":
        if (!values.stopPrice || isNaN(Number(values.stopPrice))) {
          toast({
            title: "Trade Error",
            description: "Please enter a valid stop price",
            variant: "destructive",
          });
          return;
        }
        openPrice = Number(values.stopPrice);
        break;
        
      default:
        toast({
          title: "Trade Error",
          description: "Invalid order type",
          variant: "destructive",
        });
        return;
    }

    // For pending orders, use pendingSide; for market orders, use tradeDirection
    const effectiveDirection = orderType === "Market" ? tradeDirection : pendingSide;

    // Create trade request with order-specific fields and proper types
    const tradeRequest: any = {
      symbolId: selectedSymbolConfig.id,
      type: effectiveDirection,
      lots: Number(values.lots),
      orderType: orderType,
      // Only include openPrice for Market orders (pending orders don't have it yet)
      ...(orderType === "Market" && { openPrice: openPrice }),
    };
    
    // Add order-specific fields
    if (orderType === "Limit" && values.limitPrice) {
      tradeRequest.limitPrice = Number(values.limitPrice);
    }
    
    if (orderType === "Stop" && values.stopPrice) {
      tradeRequest.stopPrice = Number(values.stopPrice);
    }
    
    // Add TP/SL if provided
    if (values.takeProfit) {
      tradeRequest.takeProfit = Number(values.takeProfit);
    }
    if (values.stopLoss) {
      tradeRequest.stopLoss = Number(values.stopLoss);
    }
    
    executeTrade.mutate(tradeRequest);
  };

  // For the lots presets
  const handleLotsPreset = (lots: string) => {
    form.setValue("lots", lots, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
  };

  // Function to handle closing a trade (server determines close price)
  const handleCloseTrade = (tradeId: number) => {
    setClosingTradeId(tradeId);
    closeTrade.mutate(
      { id: tradeId },
      {
        onSettled: () => setClosingTradeId(null),
      }
    );
  };

  return (
    <div className="h-full flex flex-col bg-neutral-900 overflow-hidden">
      {/* Symbol info header */}
      <div className="border-b border-gray-800 shrink-0">
        <div className="p-4">
          <div className="flex justify-between items-center">
            <div>
              {currentQuote ? (
                <>
                  <h3 className="text-xl font-medium text-white">{selectedSymbol}</h3>
                  <p className="text-sm text-gray-400">{currentQuote.name}</p>
                </>
              ) : (
                <>
                  <Skeleton className="h-6 w-24 mb-1" />
                  <Skeleton className="h-4 w-40" />
                </>
              )}
            </div>
            <div className="text-right">
              {currentPrice ? (
                <>
                  <div className="font-mono text-2xl font-medium text-white">
                    {currentPrice.toFixed(
                      selectedSymbol.includes("JPY") ? 2 : 4
                    )}
                  </div>
                  <div className={`text-sm ${currentQuote?.changePct && currentQuote.changePct >= 0 
                    ? "text-success-500" 
                    : "text-danger-500"}`}>
                    {currentQuote?.changePct && currentQuote.changePct >= 0 ? "+" : ""}
                    {currentQuote?.changePct !== undefined ? currentQuote.changePct.toFixed(2) : "0.00"}% today
                  </div>
                </>
              ) : (
                <>
                  <Skeleton className="h-8 w-24 mb-1 ml-auto" />
                  <Skeleton className="h-4 w-16 ml-auto" />
                </>
              )}
            </div>
          </div>
          
          {/* Market information - responsive layout */}
          <div className="flex flex-col gap-3 mt-4">
            {/* Bid/Ask/Spread row */}
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col min-w-[60px]">
                <span className="text-xs text-gray-400">Bid</span>
                {bidPrice ? (
                  <span className="font-mono text-danger-500 text-sm">
                    {bidPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </div>
              <div className="flex flex-col min-w-[60px]">
                <span className="text-xs text-gray-400">Ask</span>
                {askPrice ? (
                  <span className="font-mono text-success-500 text-sm">
                    {askPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </div>
              <div className="flex flex-col min-w-[60px]">
                <span className="text-xs text-gray-400">Spread</span>
                {spread ? (
                  <span className="font-mono text-sm">
                    {spread.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </div>
            </div>
            
            {/* Account metrics - responsive grid with real-time data */}
            <div className="w-full">
              <span className="text-xs text-gray-400 mb-1 block">Account</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-neutral-800 p-2 rounded-md">
                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500">Balance</span>
                  {accountSummary ? (
                    <span className="font-mono text-white text-xs truncate">
                      ${accountSummary.balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )}
                </div>
                
                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500">Equity</span>
                  {accountSummary ? (
                    <span className={`font-mono text-xs truncate ${accountSummary.floatingPnl >= 0 ? 'text-success-500' : 'text-danger-500'}`}>
                      ${accountSummary.equity.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )}
                </div>
                
                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500">Free Margin</span>
                  {accountSummary ? (
                    <span className="font-mono text-white text-xs truncate">
                      ${accountSummary.freeMargin.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )}
                </div>
                
                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500">Used Margin</span>
                  {accountSummary ? (
                    <span className="font-mono text-yellow-400 text-xs truncate">
                      ${accountSummary.usedMargin.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main tabbed content area */}
      <div className="flex-1 min-h-0 overflow-auto">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full"
        >
          <TabsList className="w-full grid grid-cols-3 rounded-none bg-neutral-800">
            <TabsTrigger 
              value="place-order"
              className="data-[state=active]:bg-neutral-700 rounded-none"
            >
              Place Order
            </TabsTrigger>
            <TabsTrigger 
              value="active-positions"
              className="data-[state=active]:bg-neutral-700 rounded-none"
            >
              Active Positions
            </TabsTrigger>
            <TabsTrigger 
              value="pending-orders"
              className="data-[state=active]:bg-neutral-700 rounded-none"
            >
              Pending Orders
            </TabsTrigger>
          </TabsList>
          
          {/* Place Order Tab */}
          <TabsContent value="place-order" className="p-0 m-0">
            <div className="flex flex-col lg:flex-row">
              {/* Order form */}
              <div className="w-full flex flex-col">
                <div className="px-4 py-3 border-b border-gray-800">
                  <h2 className="text-lg font-semibold text-white">Order Details</h2>
                </div>

                <div className="p-4 flex-grow">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                      <div className="space-y-2">
                        <FormLabel>Order Type</FormLabel>
                        <div className="flex space-x-2">
                          <Button
                            type="button"
                            variant={orderType === "Market" ? "default" : "outline"}
                            className={`flex-1 py-2 px-4 ${
                              orderType === "Market"
                                ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                                : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                            }`}
                            onClick={() => setOrderType("Market")}
                          >
                            Market
                          </Button>
                          <Button
                            type="button"
                            variant={orderType === "Limit" ? "default" : "outline"}
                            className={`flex-1 py-2 px-4 ${
                              orderType === "Limit"
                                ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                                : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                            }`}
                            onClick={() => setOrderType("Limit")}
                          >
                            Limit
                          </Button>
                          <Button
                            type="button"
                            variant={orderType === "Stop" ? "default" : "outline"}
                            className={`flex-1 py-2 px-4 ${
                              orderType === "Stop"
                                ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                                : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                            }`}
                            onClick={() => setOrderType("Stop")}
                          >
                            Stop
                          </Button>
                        </div>
                      </div>

                      {/* BUY/SELL side selector for Limit/Stop orders */}
                      {orderType !== "Market" && (
                        <div className="flex gap-2 my-3">
                          <Button
                            type="button"
                            variant={pendingSide === "BUY" ? "default" : "outline"}
                            className={`flex-1 py-2 ${
                              pendingSide === "BUY"
                                ? "bg-lime-600 hover:bg-lime-700 text-black font-bold"
                                : "bg-neutral-900 border border-gray-700 text-gray-400"
                            }`}
                            onClick={() => setPendingSide("BUY")}
                          >
                            BUY {orderType.toUpperCase()}
                          </Button>
                          <Button
                            type="button"
                            variant={pendingSide === "SELL" ? "default" : "outline"}
                            className={`flex-1 py-2 ${
                              pendingSide === "SELL"
                                ? "bg-orange-600 hover:bg-orange-700 text-white font-bold"
                                : "bg-neutral-900 border border-gray-700 text-gray-400"
                            }`}
                            onClick={() => setPendingSide("SELL")}
                          >
                            SELL {orderType.toUpperCase()}
                          </Button>
                        </div>
                      )}

                      <FormField
                        control={form.control}
                        name="lots"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Position Size (Lots)</FormLabel>
                            <div className="relative">
                              <FormControl>
                                <Select
                                  value={field.value?.toString() || "1"}
                                  onValueChange={(value) => field.onChange(value)}
                                >
                                  <SelectTrigger className="w-full py-2 pl-3 pr-12 bg-neutral-800 border border-gray-700 rounded-md text-white">
                                    <SelectValue placeholder="1" />
                                  </SelectTrigger>
                                  <SelectContent 
                                    className="max-h-[calc(8*2.25rem)] overflow-y-auto w-24 bg-neutral-900 border-gray-700"
                                  >
                                    {/* Common lot sizes */}
                                    <SelectItem value="1" className="text-white hover:bg-neutral-800">1</SelectItem>
                                    <SelectItem value="2" className="text-white hover:bg-neutral-800">2</SelectItem>
                                    <SelectItem value="3" className="text-white hover:bg-neutral-800">3</SelectItem>
                                    <SelectItem value="5" className="text-white hover:bg-neutral-800">5</SelectItem>
                                    <SelectItem value="10" className="text-white hover:bg-neutral-800">10</SelectItem>
                                    <SelectItem value="15" className="text-white hover:bg-neutral-800">15</SelectItem>
                                    <SelectItem value="20" className="text-white hover:bg-neutral-800">20</SelectItem>
                                    <SelectItem value="25" className="text-white hover:bg-neutral-800">25</SelectItem>
                                    <SelectItem value="30" className="text-white hover:bg-neutral-800">30</SelectItem>
                                    <SelectItem value="40" className="text-white hover:bg-neutral-800">40</SelectItem>
                                    <SelectItem value="50" className="text-white hover:bg-neutral-800">50</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <span className="text-gray-400">Lots</span>
                              </div>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              1 lot = $100,000 (${Number(field.value || 1) * 100000} total)
                            </div>
                            <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className={`py-1 px-2 text-xs ${
                                  field.value === "1"
                                    ? "bg-primary-800 text-white font-medium"
                                    : "bg-neutral-800 text-gray-300"
                                }`}
                                onClick={() => handleLotsPreset("1")}
                              >
                                1
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={`py-1 px-2 text-xs ${
                                  field.value === "5"
                                    ? "bg-primary-800 text-white font-medium"
                                    : "bg-neutral-800 text-gray-300"
                                }`}
                                onClick={() => handleLotsPreset("5")}
                              >
                                5
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={`py-1 px-2 text-xs ${
                                  field.value === "10"
                                    ? "bg-primary-800 text-white font-medium"
                                    : "bg-neutral-800 text-gray-300"
                                }`}
                                onClick={() => handleLotsPreset("10")}
                              >
                                10
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={`py-1 px-2 text-xs ${
                                  field.value === "25"
                                    ? "bg-primary-800 text-white font-medium"
                                    : "bg-neutral-800 text-gray-300"
                                }`}
                                onClick={() => handleLotsPreset("25")}
                              >
                                25
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={`py-1 px-2 text-xs ${
                                  field.value === "50"
                                    ? "bg-primary-800 text-white font-medium"
                                    : "bg-neutral-800 text-gray-300"
                                }`}
                                onClick={() => handleLotsPreset("50")}
                              >
                                50
                              </Button>
                            </div>
                          </FormItem>
                        )}
                      />

                      {/* Limit Price (only shown for Limit orders) */}
                      {orderType === "Limit" && (
                        <FormField
                          control={form.control}
                          name="limitPrice"
                          render={({ field }) => (
                            <FormItem className="mb-5">
                              <FormLabel>Limit Price</FormLabel>
                              <div className="relative">
                                <FormControl>
                                  <Input
                                    {...field}
                                    onFocus={() => setAutoEntry(false)}
                                    onBlur={() => setAutoEntry(false)}
                                    className="w-full py-2 pl-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400"
                                    placeholder={
                                      currentPrice
                                        ? currentPrice.toFixed(
                                            selectedSymbol.includes("JPY") ? 2 : 4
                                          )
                                        : "0.0000"
                                    }
                                  />
                                </FormControl>
                              </div>
                            </FormItem>
                          )}
                        />
                      )}

                      {/* Stop Price (only shown for Stop orders) */}
                      {orderType === "Stop" && (
                        <FormField
                          control={form.control}
                          name="stopPrice"
                          render={({ field }) => (
                            <FormItem className="mb-5">
                              <FormLabel>Stop Price</FormLabel>
                              <div className="relative">
                                <FormControl>
                                  <Input
                                    {...field}
                                    onFocus={() => setAutoEntry(false)}
                                    onBlur={() => setAutoEntry(false)}
                                    className="w-full py-2 pl-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400"
                                    placeholder={
                                      currentPrice
                                        ? currentPrice.toFixed(
                                            selectedSymbol.includes("JPY") ? 2 : 4
                                          )
                                        : "0.0000"
                                    }
                                  />
                                </FormControl>
                              </div>
                            </FormItem>
                          )}
                        />
                      )}

                      <div className="space-y-2">
                        <FormLabel>Take Profit / Stop Loss</FormLabel>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <FormField
                            control={form.control}
                            name="takeProfit"
                            render={({ field }) => (
                              <FormItem>
                                <div className="relative">
                                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                    <span className="text-xs font-semibold text-success-500">TP</span>
                                  </div>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      onFocus={() => setAutoTp(false)}
                                      onBlur={() => setAutoTp(false)}
                                      className="w-full py-2 pl-10 pr-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary"
                                      placeholder={
                                        currentPrice
                                          ? (
                                              currentPrice +
                                              (currentPrice * 0.01)
                                            ).toFixed(
                                              selectedSymbol.includes("JPY") ? 2 : 4
                                            )
                                          : "0.00"
                                      }
                                    />
                                  </FormControl>
                                </div>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="stopLoss"
                            render={({ field }) => (
                              <FormItem>
                                <div className="relative">
                                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                    <span className="text-xs font-semibold text-danger-500">SL</span>
                                  </div>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      onFocus={() => setAutoSl(false)}
                                      onBlur={() => setAutoSl(false)}
                                      className="w-full py-2 pl-10 pr-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary"
                                      placeholder={
                                        currentPrice
                                          ? (
                                              currentPrice -
                                              (currentPrice * 0.01)
                                            ).toFixed(
                                              selectedSymbol.includes("JPY") ? 2 : 4
                                            )
                                          : "0.00"
                                      }
                                    />
                                  </FormControl>
                                </div>
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>

                      <div className="pt-3">
                        {/* For pending orders: single button with price label */}
                        {orderType !== "Market" ? (
                          <Button
                            type="submit"
                            className={`w-full py-3 px-4 font-bold shadow-md transition-all ${
                              pendingSide === "BUY"
                                ? "bg-lime-500 hover:bg-lime-600 text-black"
                                : "bg-orange-500 hover:bg-orange-600 text-white"
                            }`}
                            disabled={executeTrade.isPending || !currentPrice}
                            onClick={() => setTradeDirection(pendingSide)}
                          >
                            {executeTrade.isPending ? (
                              <div className="animate-spin mr-2 h-4 w-4 border-t-2 rounded-full inline-block"></div>
                            ) : null}
                            Place {pendingSide} {orderType.toUpperCase()}
                            {(() => {
                              const entryPrice = orderType === "Limit" 
                                ? form.getValues("limitPrice") 
                                : form.getValues("stopPrice");
                              return entryPrice ? (
                                <span className="text-xs block">@ {entryPrice}</span>
                              ) : null;
                            })()}
                          </Button>
                        ) : (
                          /* Market orders: dual BUY/SELL buttons */
                          <div className="flex space-x-3">
                          <Button
                            type="submit"
                            className="btn-sell flex-1 py-3 px-4 text-white font-bold bg-orange-500 hover:bg-orange-600 shadow-md transition-all"
                            disabled={executeTrade.isPending || !currentPrice}
                            onClick={() => setTradeDirection("SELL")}
                          >
                            {executeTrade.isPending && tradeDirection === "SELL" ? (
                              <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-white rounded-full"></div>
                            ) : null}
                            SELL
                            {bidPrice && (
                              <span className="text-xs block">@ {bidPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}</span>
                            )}
                          </Button>
                          <Button
                            type="submit"
                            className="btn-buy flex-1 py-3 px-4 text-black font-bold bg-lime-500 hover:bg-lime-600 shadow-md transition-all"
                            disabled={executeTrade.isPending || !currentPrice}
                            onClick={() => setTradeDirection("BUY")}
                          >
                            {executeTrade.isPending && tradeDirection === "BUY" ? (
                              <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-black rounded-full"></div>
                            ) : null}
                            BUY
                            {askPrice && (
                              <span className="text-xs block">@ {askPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}</span>
                            )}
                          </Button>
                          </div>
                        )}
                      </div>
                    </form>
                  </Form>
                </div>
              </div>
            </div>
          </TabsContent>
          
          {/* Active Positions Tab */}
          <TabsContent value="active-positions" className="p-0 m-0">
            <div className="p-4">
              <h2 className="text-lg font-semibold text-white mb-4">Active Positions</h2>
              
              {isLoadingOpenTrades ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin h-6 w-6 border-2 border-primary rounded-full border-t-transparent"></div>
                </div>
              ) : Array.isArray(openTrades) && openTrades.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No active positions. Place an order to open a position.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[800px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Open Time</TableHead>
                        <TableHead>Open Price</TableHead>
                        <TableHead>Current Price</TableHead>
                        <TableHead>TP</TableHead>
                        <TableHead>SL</TableHead>
                        <TableHead>P/L</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.isArray(openTrades) && openTrades.map((trade: Trade) => {
                        const tradeSymbol = symbols.find(s => s.id === trade.symbolId)?.symbol || '';
                        const tradeQuote = quotes.find(q => q.symbol === tradeSymbol);
                        const currentTradePrice = tradeQuote?.price || currentPrice;
                        
                        // Calculate profit/loss using MT4/5-style calculations
                        let pl = 0;
                        if (currentTradePrice) {
                          const isJpyPair = tradeSymbol.includes('JPY');
                          const pipSize = isJpyPair ? 0.01 : 0.0001;
                          const contractSize = 100000; // Standard lot size
                          
                          // Calculate price difference in pips
                          const priceDiff = trade.type === 'BUY' 
                            ? currentTradePrice - trade.openPrice 
                            : trade.openPrice - currentTradePrice;
                          
                          const pips = priceDiff / pipSize;
                          
                          if (isJpyPair) {
                            // For JPY pairs: pipValue = (contractSize * pipSize) / currentPrice
                            const pipValueInUsd = (contractSize * pipSize) / currentTradePrice;
                            pl = pips * pipValueInUsd * trade.lots;
                          } else if (tradeSymbol.startsWith('USD')) {
                            // For USD base pairs (USDJPY, USDCAD, etc.)
                            // Each pip is worth (contractSize * pipSize)
                            pl = pips * (contractSize * pipSize) * trade.lots;
                          } else {
                            // For other pairs (EURUSD, GBPUSD, etc.)
                            // Each pip is worth (contractSize * pipSize)
                            pl = pips * (contractSize * pipSize) * trade.lots;
                          }
                        }
                        
                        return (
                          <TableRow 
                            key={trade.id} 
                            className={trade.type === 'BUY' ? 'bg-success-50/5' : 'bg-danger-50/5'}
                          >
                            <TableCell>{tradeSymbol}</TableCell>
                            <TableCell className={`uppercase font-semibold ${trade.type === 'BUY' ? 'text-lime-500 font-medium' : 'text-orange-500 font-medium'}`}>
                              {trade.type}
                            </TableCell>
                            <TableCell>{trade.lots} Lot{trade.lots > 1 ? 's' : ''}</TableCell>
                            <TableCell>
                              {(() => {
                                try {
                                  // Try to use openedAt first (which is when the trade was executed)
                                  const timestamp = trade.openedAt || trade.createdAt || trade.executedAt;
                                  
                                  if (!timestamp) {
                                    return new Date().toLocaleString(); // Use current time as fallback
                                  }
                                  
                                  // For Date objects
                                  if (timestamp instanceof Date) {
                                    return timestamp.toLocaleString();
                                  }
                                  
                                  // For Unix timestamps in seconds (standard in SQLite)
                                  if (typeof timestamp === 'number' && timestamp < 10000000000) {
                                    return new Date(timestamp * 1000).toLocaleString();
                                  }
                                  
                                  // For millisecond timestamps (standard in JS)
                                  if (typeof timestamp === 'number') {
                                    return new Date(timestamp).toLocaleString();
                                  }
                                  
                                  // For string timestamps that might be Unix timestamps
                                  if (typeof timestamp === 'string' && /^\d+$/.test(timestamp)) {
                                    const numTimestamp = parseInt(timestamp);
                                    // Convert seconds to milliseconds if needed
                                    const dateTimestamp = numTimestamp < 10000000000 
                                      ? numTimestamp * 1000 
                                      : numTimestamp;
                                    return new Date(dateTimestamp).toLocaleString();
                                  }
                                  
                                  // For ISO strings or other date formats
                                  const date = new Date(timestamp);
                                  if (!isNaN(date.getTime())) {
                                    return date.toLocaleString();
                                  }
                                } catch (e) {
                                  console.error("Error formatting date:", e);
                                }
                                
                                // If all else fails, use the current time instead of "Recent"
                                return new Date().toLocaleString();
                              })()}
                            </TableCell>
                            <TableCell>
                              {trade.openPrice.toFixed(tradeSymbol.includes('JPY') ? 2 : 4)}
                            </TableCell>
                            <TableCell>
                              {currentTradePrice 
                                ? currentTradePrice.toFixed(tradeSymbol.includes('JPY') ? 2 : 4)
                                : '-'
                              }
                            </TableCell>
                            <TableCell>
                              {renderTargetPill("TP", trade.takeProfit, tradeSymbol, trade.type, trade.openPrice)}
                            </TableCell>
                            <TableCell>
                              {renderTargetPill("SL", trade.stopLoss, tradeSymbol, trade.type, trade.openPrice)}
                            </TableCell>
                            <TableCell className={`font-medium ${pl > 0 ? 'text-green-400' : pl < 0 ? 'text-red-400' : 'text-white'}`}>
                              ${pl.toFixed(2)}
                              <div className="text-xs text-gray-400">
                                {tradeQuote && ((Math.abs(pl) / (trade.lots * 100000)) * 100).toFixed(4)}%
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex gap-1">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className={editIconButtonClass}
                                  onClick={() => setEditingTrade(trade)}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button 
                                  variant="destructive" 
                                  size="sm"
                                  onClick={() => handleCloseTrade(trade.id)}
                                  disabled={closingTradeId === trade.id && closeTrade.isPending}
                                >
                                  {closingTradeId === trade.id && closeTrade.isPending ? 'Closing...' : 'Close'}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Pending Orders Tab */}
          <TabsContent value="pending-orders" className="p-0 m-0">
            <div className="p-4">
              <h2 className="text-lg font-semibold text-white mb-4">Pending Orders</h2>
              
              {isLoadingPending ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin h-6 w-6 border-2 border-primary rounded-full border-t-transparent"></div>
                </div>
              ) : Array.isArray(pendingOrders) && pendingOrders.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No pending orders. Place a limit or stop order to see it here.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[800px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Order Type</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Order Price</TableHead>
                        <TableHead>TP</TableHead>
                        <TableHead>SL</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.isArray(pendingOrders) && pendingOrders.map((order: any) => {
                        const orderSymbol = symbols.find(s => s.id === order.symbolId)?.symbol || "";

                        const orderTypeLabel = String(order.orderType ?? "").trim() || "Unknown";
                        const orderTypeKey = orderTypeLabel.toLowerCase();

                        const orderPrice =
                          orderTypeKey === "limit"
                            ? order.limitPrice
                            : orderTypeKey === "stop"
                              ? order.stopPrice
                              : (order.limitPrice ?? order.stopPrice);

                        const entry = toFiniteNumber(orderPrice);
                        const OrderTypeIcon =
                          orderTypeKey === "stop" ? Zap :
                          orderTypeKey === "limit" ? Layers :
                          null;
                        const helpText = orderTypeHelp(orderTypeKey);

                        return (
                          <TableRow
                            key={order.id}
                            className={order.type === "BUY" ? "bg-success-50/5" : "bg-danger-50/5"}
                          >
                            <TableCell>{orderSymbol}</TableCell>

                            <TableCell>
                              <span
                                className={`uppercase font-semibold ${order.type === "BUY" ? "text-lime-500" : "text-orange-500"}`}
                              >
                                {order.type}
                              </span>
                            </TableCell>

                            <TableCell>
                              <span
                                title={helpText}
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${orderTypePillClass(orderTypeLabel)}`}
                              >
                                {OrderTypeIcon ? <OrderTypeIcon className="h-3 w-3 mr-1" /> : null}
                                {orderTypeLabel}
                              </span>
                            </TableCell>

                            <TableCell>{order.lots} lots</TableCell>

                            <TableCell className="font-mono tabular-nums">
                              {formatPx(orderPrice, orderSymbol)}
                            </TableCell>

                            <TableCell>
                              {renderTargetPill("TP", order.takeProfit, orderSymbol, order.type, entry)}
                            </TableCell>

                            <TableCell>
                              {renderTargetPill("SL", order.stopLoss, orderSymbol, order.type, entry)}
                            </TableCell>

                            <TableCell className="text-right">
                              <div className="flex gap-2 justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={`w-10 px-0 ${editIconButtonClass}`}
                                  onClick={() => setEditingTrade(order)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>

                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="w-10 px-0"
                                  onClick={() => cancelOrder.mutate(order.id)}
                                  disabled={cancelOrder.isPending}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
      
      {/* Edit Trade Modal */}
      {editingTrade && (
        <EditTradeModal
          trade={editingTrade}
          open={!!editingTrade}
          onOpenChange={(open) => !open && setEditingTrade(null)}
        />
      )}
    </div>
  );
}
