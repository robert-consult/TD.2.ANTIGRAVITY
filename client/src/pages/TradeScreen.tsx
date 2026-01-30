import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useEffect, useRef } from "react";
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
import { Pencil, X, Zap, Layers, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "@/i18n";
import { getTradeErrorToast } from "@/lib/tradeErrorMessages";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { useLotSettings } from "@/hooks/use-lot-settings";

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
  const { isConnected: isWsConnected } = useLiveUpdates();
  const { lotDropdownMax, lotDropdownOptions, lotPresetCards } = useLotSettings();
  const { bundle } = useTranslation();
  const { quotes } = useQuotes();
  const { openTrades = [], isLoadingOpenTrades, closeTrade } = useTrades();
  const { summary: accountSummary, isLoading: isLoadingAccountSummary } = useAccountSummary();
  const { pendingOrders = [], isLoading: isLoadingPending, cancelOrder } = usePendingOrders();

  // Container width detection for responsive table (ResizeObserver-based, not pixel breakpoints)
  const positionsContainerRef = useRef<HTMLDivElement>(null);
  const ordersContainerRef = useRef<HTMLDivElement>(null);
  // Use window.innerWidth as initial estimate (will be refined by ResizeObserver)
  const [positionsContainerWidth, setPositionsContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  const [ordersContainerWidth, setOrdersContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  // Threshold for switching to compact view (based on minimum column widths)
  // Progressive column visibility breakpoints (in pixels)
  // Columns appear progressively as container widens:
  // - Always visible: Symbol, Type, P/L
  // - 350px+: Edit/Close Actions
  // - 450px+: Size/Lots  
  // - 550px+: TP/SL
  // - 700px+: Entry/Open Price, Current Price (positions) or Order Price (pending)
  // - 900px+: Open Time (positions)
  const COLUMN_BREAKPOINTS = {
    ACTIONS: 350,
    SIZE: 450,
    TP_SL: 550,
    PRICES: 700,
    TIME: 900,
  };

  // Determine which columns are visible based on container width
  const getVisibleColumns = (width: number) => ({
    actions: width >= COLUMN_BREAKPOINTS.ACTIONS,
    size: width >= COLUMN_BREAKPOINTS.SIZE,
    tpSl: width >= COLUMN_BREAKPOINTS.TP_SL,
    prices: width >= COLUMN_BREAKPOINTS.PRICES,
    time: width >= COLUMN_BREAKPOINTS.TIME,
  });

  const positionColumns = getVisibleColumns(positionsContainerWidth);
  const orderColumns = getVisibleColumns(ordersContainerWidth);

  // Check if there are any hidden columns (for showing expand chevron)
  // Show chevron when any column (including actions) is hidden
  const hasHiddenPositionColumns = !positionColumns.time || !positionColumns.actions;
  const hasHiddenOrderColumns = !orderColumns.tpSl || !orderColumns.actions;

  // Expandable row state
  const [expandedPositionRows, setExpandedPositionRows] = useState<Set<number>>(new Set());
  const [expandedOrderRows, setExpandedOrderRows] = useState<Set<number>>(new Set());

  const togglePositionExpand = (id: number) => {
    setExpandedPositionRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleOrderExpand = (id: number) => {
    setExpandedOrderRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ResizeObserver for positions container
  useEffect(() => {
    const container = positionsContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPositionsContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);
    setPositionsContainerWidth(container.clientWidth);

    return () => observer.disconnect();
  }, [activeTab]);

  // ResizeObserver for orders container
  useEffect(() => {
    const container = ordersContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setOrdersContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);
    setOrdersContainerWidth(container.clientWidth);

    return () => observer.disconnect();
  }, [activeTab]);

  // Window resize fallback for tabs that haven't been visited yet
  useEffect(() => {
    const handleResize = () => {
      // Use container width if available, otherwise use window width
      if (positionsContainerRef.current) {
        setPositionsContainerWidth(positionsContainerRef.current.clientWidth);
      } else {
        setPositionsContainerWidth(window.innerWidth);
      }
      if (ordersContainerRef.current) {
        setOrdersContainerWidth(ordersContainerRef.current.clientWidth);
      } else {
        setOrdersContainerWidth(window.innerWidth);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const formatTemplate = (template: string, vars: Record<string, string | number | boolean | null | undefined>) =>
    template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
      const v = vars?.[key];
      return v === null || v === undefined ? "" : String(v);
    });

  const sideLabels: Record<string, { label: string }> = {
    BUY: { label: "Buy" },
    SELL: { label: "Sell" },
  };

  const orderTypeLabels: Record<string, { label: string }> = {
    market: { label: "Market" },
    limit: { label: "Limit" },
    stop: { label: "Stop" },
    unknown: { label: "Unknown" },
  };

  const pendingOrderLabels: Record<string, Record<string, { label: string }>> = {
    BUY: {
      limit: { label: "Buy Limit" },
      stop: { label: "Buy Stop" },
    },
    SELL: {
      limit: { label: "Sell Limit" },
      stop: { label: "Sell Stop" },
    },
  };
  const toastTemplates = {
    orderPlaced: { text: "Successfully placed a {side} order for {symbol}" },
    tradeExecutedTitle: { text: "Trade Executed" },
    tradeErrorTitle: { text: "Trade Error" },
    missingTradeInfo: { text: "Missing required trade information" },
    marketPriceMissing: { text: "Current price is not available for market order" },
    limitPriceMissing: { text: "Please enter a valid limit price" },
    stopPriceMissing: { text: "Please enter a valid stop price" },
    invalidOrderType: { text: "Invalid order type" },
  };

  const getSideLabel = (side: unknown): string => {
    const key = String(side ?? "").trim().toUpperCase();
    if (!key) return "—";
    return sideLabels[key]?.label ?? key;
  };

  const getOrderTypeLabel = (type: unknown): string => {
    const raw = String(type ?? "").trim();
    if (!raw) return orderTypeLabels.unknown.label;
    const key = raw.toLowerCase();
    return orderTypeLabels[key]?.label ?? raw;
  };

  const getPendingOrderLabel = (side: "BUY" | "SELL", type: unknown): string => {
    const sideKey = String(side ?? "").trim().toUpperCase();
    const typeKey = String(type ?? "").trim().toLowerCase();
    const direct = pendingOrderLabels[sideKey]?.[typeKey]?.label;
    if (direct) return direct;
    const sideLabel = getSideLabel(sideKey);
    const typeLabel = getOrderTypeLabel(typeKey);
    return `${sideLabel} ${typeLabel}`.trim();
  };

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

  const targetHintText: Record<"BUY" | "SELL", Record<"TP" | "SL", { text: string }>> = {
    BUY: {
      TP: { text: "Warning: For Buy, TP should be above entry." },
      SL: { text: "Warning: For Buy, SL should be below entry." },
    },
    SELL: {
      TP: { text: "Warning: For Sell, TP should be below entry." },
      SL: { text: "Warning: For Sell, SL should be above entry." },
    },
  };

  const targetHint = (side: "BUY" | "SELL", kind: "TP" | "SL"): string => {
    const sideKey = side === "SELL" ? "SELL" : "BUY";
    return targetHintText[sideKey][kind].text;
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

  const orderTypeHelpText: Record<string, { text: string }> = {
    stop: { text: "Stop (trigger): Executes when market reaches your stop price. Commonly used for breakout entries." },
    limit: { text: "Limit (passive): Executes at your limit price or better. Commonly used for pullback entries." },
    default: { text: "Order mechanism (Stop/Limit)." },
  };

  const getOrderTypeHelp = (t: string): string => {
    const key = String(t ?? "").trim().toLowerCase();
    return orderTypeHelpText[key]?.text ?? orderTypeHelpText.default.text;
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

  // Keep lots selection valid when admin updates dropdown maximum.
  useEffect(() => {
    const current = Number(form.getValues("lots") || 1);
    if (!Number.isFinite(current) || current < 1) {
      form.setValue("lots", "1", { shouldValidate: true, shouldDirty: true });
      return;
    }
    if (current > lotDropdownMax) {
      form.setValue("lots", String(lotDropdownMax), { shouldValidate: true, shouldDirty: true });
    }
  }, [form, lotDropdownMax]);

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
      // WS-first: only hit REST when WS is unavailable.
      if (!isWsConnected) {
        queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
        queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
      }

      toast({
        title: toastTemplates.tradeExecutedTitle.text,
        description: formatTemplate(toastTemplates.orderPlaced.text, {
          side: tradeDirection ? getSideLabel(tradeDirection) : "—",
          symbol: selectedSymbol,
        }),
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
      const { title, description } = getTradeErrorToast(error, { symbol: selectedSymbol });

      toast({
        title,
        description,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: TradeFormValues) => {
    if (!tradeDirection || !selectedSymbolConfig) {
      toast({
        title: toastTemplates.tradeErrorTitle.text,
        description: toastTemplates.missingTradeInfo.text,
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
            title: toastTemplates.tradeErrorTitle.text,
            description: toastTemplates.marketPriceMissing.text,
            variant: "destructive",
          });
          return;
        }
        openPrice = currentPrice;
        break;

      case "Limit":
        if (!values.limitPrice || isNaN(Number(values.limitPrice))) {
          toast({
            title: toastTemplates.tradeErrorTitle.text,
            description: toastTemplates.limitPriceMissing.text,
            variant: "destructive",
          });
          return;
        }
        openPrice = Number(values.limitPrice);
        break;

      case "Stop":
        if (!values.stopPrice || isNaN(Number(values.stopPrice))) {
          toast({
            title: toastTemplates.tradeErrorTitle.text,
            description: toastTemplates.stopPriceMissing.text,
            variant: "destructive",
          });
          return;
        }
        openPrice = Number(values.stopPrice);
        break;

      default:
        toast({
          title: toastTemplates.tradeErrorTitle.text,
          description: toastTemplates.invalidOrderType.text,
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
    <div className="h-full flex flex-col bg-neutral-900 overflow-hidden @container/trade" style={{ containerType: 'inline-size', containerName: 'trade' }}>
      {/* Symbol info header */}
      <div className="border-b border-gray-800 shrink-0">
        <div className="px-3 sm:px-gutter py-3 sm:py-4">
          <div className="flex justify-between items-center">
            <div>
              {currentQuote ? (
                <>
                  <h3 className="text-cq-lg font-medium text-white">{selectedSymbol}</h3>
                  <p className="text-cq-xs text-gray-400 truncate max-w-[120px] @[400px]/trade:max-w-[150px] @[600px]/trade:max-w-none">{currentQuote.name}</p>
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
                  <div className="price-display text-white">
                    {currentPrice.toFixed(
                      selectedSymbol.includes("JPY") ? 2 : 4
                    )}
                  </div>
                  <div className={`text-cq-sm ${currentQuote?.changePct && currentQuote.changePct >= 0
                    ? "text-success-500"
                    : "text-danger-500"}`}>
                    {currentQuote?.changePct && currentQuote.changePct >= 0 ? "+" : ""}
                    {currentQuote?.changePct !== undefined ? currentQuote.changePct.toFixed(2) : "0.00"}%<span className="cq-hide-narrow"> today</span>
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
              <div className="flex flex-col min-w-[50px]">
                <span className="text-cq-xs text-gray-400">Bid</span>
                {bidPrice ? (
                  <span className="data-cell text-danger-500">
                    {bidPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </div>
              <div className="flex flex-col min-w-[50px]">
                <span className="text-cq-xs text-gray-400">Ask</span>
                {askPrice ? (
                  <span className="data-cell text-success-500">
                    {askPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </div>
              <div className="flex flex-col min-w-[50px]">
                <span className="text-cq-xs text-gray-400">Spread</span>
                {spread ? (
                  <span className="data-cell">
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
                      ${accountSummary.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )}
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500">Equity</span>
                  {accountSummary ? (
                    <span className={`font-mono text-xs truncate ${accountSummary.floatingPnl >= 0 ? 'text-success-500' : 'text-danger-500'}`}>
                      ${accountSummary.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )}
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500">Free Margin</span>
                  {accountSummary ? (
                    <span className="font-mono text-white text-xs truncate">
                      ${accountSummary.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )}
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500">Used Margin</span>
                  {accountSummary ? (
                    <span className="font-mono text-yellow-400 text-xs truncate">
                      ${accountSummary.usedMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              className="data-[state=active]:bg-neutral-700 rounded-none text-cq-sm px-1"
            >
              <span className="cq-hide-narrow">Place Order</span>
              <span className="cq-show-narrow-only">Order</span>
            </TabsTrigger>
            <TabsTrigger
              value="active-positions"
              className="data-[state=active]:bg-neutral-700 rounded-none text-cq-sm px-1"
            >
              <span className="cq-hide-narrow">Active Positions</span>
              <span className="cq-show-narrow-only">Positions</span>
            </TabsTrigger>
            <TabsTrigger
              value="pending-orders"
              className="data-[state=active]:bg-neutral-700 rounded-none text-cq-sm px-1"
            >
              <span className="cq-hide-narrow">Pending Orders</span>
              <span className="cq-show-narrow-only">Pending</span>
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
                            className={`flex-1 py-2 px-4 ${orderType === "Market"
                              ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                              : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                              }`}
                            onClick={() => setOrderType("Market")}
                          >
                            {getOrderTypeLabel("Market")}
                          </Button>
                          <Button
                            type="button"
                            variant={orderType === "Limit" ? "default" : "outline"}
                            className={`flex-1 py-2 px-4 ${orderType === "Limit"
                              ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                              : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                              }`}
                            onClick={() => setOrderType("Limit")}
                          >
                            {getOrderTypeLabel("Limit")}
                          </Button>
                          <Button
                            type="button"
                            variant={orderType === "Stop" ? "default" : "outline"}
                            className={`flex-1 py-2 px-4 ${orderType === "Stop"
                              ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                              : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                              }`}
                            onClick={() => setOrderType("Stop")}
                          >
                            {getOrderTypeLabel("Stop")}
                          </Button>
                        </div>
                      </div>

                      {/* BUY/SELL side selector for Limit/Stop orders */}
                      {orderType !== "Market" && (
                        <div className="flex gap-2 my-3">
                          <Button
                            type="button"
                            variant={pendingSide === "BUY" ? "default" : "outline"}
                            className={`flex-1 py-2 ${pendingSide === "BUY"
                              ? "bg-lime-600 hover:bg-lime-700 text-black font-bold"
                              : "bg-neutral-900 border border-gray-700 text-gray-400"
                              }`}
                            onClick={() => setPendingSide("BUY")}
                          >
                            {getPendingOrderLabel("BUY", orderType)}
                          </Button>
                          <Button
                            type="button"
                            variant={pendingSide === "SELL" ? "default" : "outline"}
                            className={`flex-1 py-2 ${pendingSide === "SELL"
                              ? "bg-orange-600 hover:bg-orange-700 text-white font-bold"
                              : "bg-neutral-900 border border-gray-700 text-gray-400"
                              }`}
                            onClick={() => setPendingSide("SELL")}
                          >
                            {getPendingOrderLabel("SELL", orderType)}
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
                              <Select
                                value={field.value?.toString() || "1"}
                                onValueChange={(value) => field.onChange(value)}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-full py-2 pl-3 pr-12 bg-neutral-800 border border-gray-700 rounded-md text-white">
                                    <SelectValue placeholder="1" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent
                                  className="max-h-[calc(8*2.25rem)] overflow-y-auto w-24 bg-neutral-900 border-gray-700"
                                >
                                  {lotDropdownOptions.map((lot) => (
                                    <SelectItem
                                      key={lot}
                                      value={lot.toString()}
                                      className="text-white hover:bg-neutral-800"
                                    >
                                      {lot}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <span className="text-gray-400">Lots</span>
                              </div>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              1 lot = $100,000 (${Number(field.value || 1) * 100000} total)
                            </div>
                            <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-2">
                              {lotPresetCards.map((preset) => {
                                const value = preset.toString();
                                return (
                                  <Button
                                    key={value}
                                    type="button"
                                    variant="outline"
                                    className={`py-1 px-2 text-xs ${field.value === value
                                      ? "bg-primary-800 text-white font-medium"
                                      : "bg-neutral-800 text-gray-300"
                                      }`}
                                    onClick={() => handleLotsPreset(value)}
                                  >
                                    {value}
                                  </Button>
                                );
                              })}
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
                            className={`w-full py-3 px-4 font-bold shadow-md transition-all ${pendingSide === "BUY"
                              ? "bg-lime-500 hover:bg-lime-600 text-black"
                              : "bg-orange-500 hover:bg-orange-600 text-white"
                              }`}
                            disabled={executeTrade.isPending || !currentPrice}
                            onClick={() => setTradeDirection(pendingSide)}
                          >
                            {executeTrade.isPending ? (
                              <div className="animate-spin mr-2 h-4 w-4 border-t-2 rounded-full inline-block"></div>
                            ) : null}
                            Place {getPendingOrderLabel(pendingSide, orderType)}
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
                              className="btn-sell flex-1 py-3 px-4 text-white font-bold bg-orange-500 hover:bg-orange-600 shadow-md transition-all uppercase"
                              disabled={executeTrade.isPending || !currentPrice}
                              onClick={() => setTradeDirection("SELL")}
                            >
                              {executeTrade.isPending && tradeDirection === "SELL" ? (
                                <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-white rounded-full"></div>
                              ) : null}
                              {getSideLabel("SELL")}
                              {bidPrice && (
                                <span className="text-xs block">@ {bidPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}</span>
                              )}
                            </Button>
                            <Button
                              type="submit"
                              className="btn-buy flex-1 py-3 px-4 text-black font-bold bg-lime-500 hover:bg-lime-600 shadow-md transition-all uppercase"
                              disabled={executeTrade.isPending || !currentPrice}
                              onClick={() => setTradeDirection("BUY")}
                            >
                              {executeTrade.isPending && tradeDirection === "BUY" ? (
                                <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-black rounded-full"></div>
                              ) : null}
                              {getSideLabel("BUY")}
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
            <div ref={positionsContainerRef} className="p-4">
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
                <div>
                  {/* Progressive table view - always table, columns appear as space allows */}
                  <div className="overflow-x-auto">
                    <Table className="w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Symbol</TableHead>
                          <TableHead className="whitespace-nowrap">Type</TableHead>
                          {positionColumns.size && <TableHead className="whitespace-nowrap">Size</TableHead>}
                          {positionColumns.time && <TableHead className="whitespace-nowrap min-w-[120px]">Open Time</TableHead>}
                          {positionColumns.prices && (
                            <>
                              <TableHead className="whitespace-nowrap min-w-[80px]">Open Price</TableHead>
                              <TableHead className="whitespace-nowrap min-w-[70px]">Current</TableHead>
                            </>
                          )}
                          {positionColumns.tpSl && (
                            <>
                              <TableHead className="whitespace-nowrap">TP</TableHead>
                              <TableHead className="whitespace-nowrap">SL</TableHead>
                            </>
                          )}
                          <TableHead className="whitespace-nowrap min-w-[90px]">P/L</TableHead>
                          {positionColumns.actions && <TableHead className="text-right whitespace-nowrap">Action</TableHead>}
                          {hasHiddenPositionColumns && <TableHead className="w-8"></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.isArray(openTrades) && openTrades.map((trade: Trade) => {
                          const tradeSymbol = symbols.find(s => s.id === trade.symbolId)?.symbol || '';
                          const tradeQuote = quotes.find(q => q.symbol === tradeSymbol);
                          const currentTradePrice = tradeQuote?.price || currentPrice;
                          const isJpy = tradeSymbol.includes('JPY');
                          const isExpanded = expandedPositionRows.has(trade.id);

                          // Calculate profit/loss using MT4/5-style calculations
                          let pl = 0;
                          if (currentTradePrice) {
                            const pipSize = isJpy ? 0.01 : 0.0001;
                            const contractSize = 100000;
                            const priceDiff = trade.type === 'BUY'
                              ? currentTradePrice - trade.openPrice
                              : trade.openPrice - currentTradePrice;
                            const pips = priceDiff / pipSize;

                            if (isJpy) {
                              const pipValueInUsd = (contractSize * pipSize) / currentTradePrice;
                              pl = pips * pipValueInUsd * trade.lots;
                            } else {
                              pl = pips * (contractSize * pipSize) * trade.lots;
                            }
                          }

                          return (
                            <>
                              <TableRow
                                key={trade.id}
                                className={`${trade.type === 'BUY' ? 'bg-success-50/5' : 'bg-danger-50/5'} ${hasHiddenPositionColumns ? 'cursor-pointer hover:bg-neutral-850' : ''}`}
                                onClick={hasHiddenPositionColumns ? () => togglePositionExpand(trade.id) : undefined}
                              >
                                <TableCell className="whitespace-nowrap font-medium">{tradeSymbol}</TableCell>
                                <TableCell className={`uppercase font-semibold whitespace-nowrap ${trade.type === 'BUY' ? 'text-lime-500' : 'text-orange-500'}`}>
                                  {getSideLabel(trade.type)}
                                </TableCell>
                                {positionColumns.size && (
                                  <TableCell className="whitespace-nowrap">{trade.lots} Lot{trade.lots > 1 ? 's' : ''}</TableCell>
                                )}
                                {positionColumns.time && (
                                  <TableCell className="whitespace-nowrap text-sm text-gray-400">
                                    {(() => {
                                      try {
                                        const timestamp = trade.openedAt || trade.createdAt || trade.executedAt;
                                        if (!timestamp) return new Date().toLocaleString();
                                        if (timestamp instanceof Date) return timestamp.toLocaleString();
                                        if (typeof timestamp === 'number' && timestamp < 10000000000) {
                                          return new Date(timestamp * 1000).toLocaleString();
                                        }
                                        if (typeof timestamp === 'number') return new Date(timestamp).toLocaleString();
                                        const date = new Date(timestamp);
                                        if (!isNaN(date.getTime())) return date.toLocaleString();
                                      } catch (e) { /**/ }
                                      return new Date().toLocaleString();
                                    })()}
                                  </TableCell>
                                )}
                                {positionColumns.prices && (
                                  <>
                                    <TableCell className="font-mono whitespace-nowrap">
                                      {trade.openPrice.toFixed(isJpy ? 2 : 4)}
                                    </TableCell>
                                    <TableCell className="font-mono whitespace-nowrap">
                                      {currentTradePrice ? currentTradePrice.toFixed(isJpy ? 2 : 4) : '-'}
                                    </TableCell>
                                  </>
                                )}
                                {positionColumns.tpSl && (
                                  <>
                                    <TableCell className="whitespace-nowrap">
                                      {renderTargetPill("TP", trade.takeProfit, tradeSymbol, trade.type, trade.openPrice)}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap">
                                      {renderTargetPill("SL", trade.stopLoss, tradeSymbol, trade.type, trade.openPrice)}
                                    </TableCell>
                                  </>
                                )}
                                <TableCell className={`font-medium font-mono whitespace-nowrap ${pl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {pl >= 0 ? '+' : ''}${pl.toFixed(2)}
                                </TableCell>
                                {positionColumns.actions && (
                                  <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex gap-1 justify-end">
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
                                        {closingTradeId === trade.id && closeTrade.isPending ? '...' : 'Close'}
                                      </Button>
                                    </div>
                                  </TableCell>
                                )}
                                {hasHiddenPositionColumns && (
                                  <TableCell className="w-8 text-gray-400">
                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </TableCell>
                                )}
                              </TableRow>
                              {/* Expandable details for hidden columns */}
                              {isExpanded && hasHiddenPositionColumns && (
                                <TableRow key={`${trade.id}-expanded`} className="bg-neutral-850">
                                  <TableCell colSpan={100} className="py-3">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                      {!positionColumns.size && (
                                        <div>
                                          <span className="text-gray-500 text-xs">Size</span>
                                          <div className="text-white">{trade.lots} Lot{trade.lots > 1 ? 's' : ''}</div>
                                        </div>
                                      )}
                                      {!positionColumns.time && (
                                        <div>
                                          <span className="text-gray-500 text-xs">Open Time</span>
                                          <div className="text-gray-300 text-xs">
                                            {(() => {
                                              const timestamp = trade.openedAt || trade.createdAt || trade.executedAt;
                                              if (!timestamp) return new Date().toLocaleString();
                                              if (timestamp instanceof Date) return timestamp.toLocaleString();
                                              if (typeof timestamp === 'number') {
                                                return new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp).toLocaleString();
                                              }
                                              const date = new Date(timestamp);
                                              return !isNaN(date.getTime()) ? date.toLocaleString() : new Date().toLocaleString();
                                            })()}
                                          </div>
                                        </div>
                                      )}
                                      {!positionColumns.prices && (
                                        <>
                                          <div>
                                            <span className="text-gray-500 text-xs">Open Price</span>
                                            <div className="text-white font-mono">{trade.openPrice.toFixed(isJpy ? 2 : 4)}</div>
                                          </div>
                                          <div>
                                            <span className="text-gray-500 text-xs">Current Price</span>
                                            <div className="text-white font-mono">{currentTradePrice?.toFixed(isJpy ? 2 : 4) || '—'}</div>
                                          </div>
                                        </>
                                      )}
                                      {!positionColumns.tpSl && (
                                        <>
                                          <div>
                                            <span className="text-gray-500 text-xs">Take Profit</span>
                                            <div>{renderTargetPill("TP", trade.takeProfit, tradeSymbol, trade.type, trade.openPrice)}</div>
                                          </div>
                                          <div>
                                            <span className="text-gray-500 text-xs">Stop Loss</span>
                                            <div>{renderTargetPill("SL", trade.stopLoss, tradeSymbol, trade.type, trade.openPrice)}</div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                    {/* Show actions in expanded section when hidden from table */}
                                    {!positionColumns.actions && (
                                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-700">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className={`flex-1 ${editIconButtonClass}`}
                                          onClick={(e) => { e.stopPropagation(); setEditingTrade(trade); }}
                                        >
                                          <Pencil className="h-3 w-3 mr-1" /> Edit
                                        </Button>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          className="flex-1"
                                          onClick={(e) => { e.stopPropagation(); handleCloseTrade(trade.id); }}
                                          disabled={closingTradeId === trade.id && closeTrade.isPending}
                                        >
                                          {closingTradeId === trade.id && closeTrade.isPending ? 'Closing...' : 'Close'}
                                        </Button>
                                      </div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              )}
                            </>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Pending Orders Tab */}
          <TabsContent value="pending-orders" className="p-0 m-0">
            <div ref={ordersContainerRef} className="p-4">
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
                <div>
                  {/* Progressive table view - always table, columns appear as space allows */}
                  <div className="overflow-x-auto">
                    <Table className="w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Symbol</TableHead>
                          <TableHead className="whitespace-nowrap">Type</TableHead>
                          <TableHead className="whitespace-nowrap">Order</TableHead>
                          {orderColumns.size && <TableHead className="whitespace-nowrap">Size</TableHead>}
                          {orderColumns.prices && <TableHead className="whitespace-nowrap min-w-[80px]">Price</TableHead>}
                          {orderColumns.tpSl && (
                            <>
                              <TableHead className="whitespace-nowrap">TP</TableHead>
                              <TableHead className="whitespace-nowrap">SL</TableHead>
                            </>
                          )}
                          {orderColumns.actions && <TableHead className="text-right whitespace-nowrap">Action</TableHead>}
                          {hasHiddenOrderColumns && <TableHead className="w-8"></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.isArray(pendingOrders) && pendingOrders.map((order: any) => {
                          const orderSymbol = symbols.find(s => s.id === order.symbolId)?.symbol || "";
                          const orderTypeLabel = String(order.orderType ?? "").trim() || "Unknown";
                          const orderTypeKey = orderTypeLabel.toLowerCase();
                          const isExpanded = expandedOrderRows.has(order.id);

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
                          const helpText = getOrderTypeHelp(orderTypeKey);
                          const orderTypeDisplay = getOrderTypeLabel(orderTypeLabel);

                          return (
                            <>
                              <TableRow
                                key={order.id}
                                className={`${order.type === "BUY" ? "bg-success-50/5" : "bg-danger-50/5"} ${hasHiddenOrderColumns ? 'cursor-pointer hover:bg-neutral-850' : ''}`}
                                onClick={hasHiddenOrderColumns ? () => toggleOrderExpand(order.id) : undefined}
                              >
                                <TableCell className="whitespace-nowrap font-medium">{orderSymbol}</TableCell>
                                <TableCell className={`uppercase font-semibold whitespace-nowrap ${order.type === "BUY" ? "text-lime-500" : "text-orange-500"}`}>
                                  {getSideLabel(order.type)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  <span
                                    title={helpText}
                                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${orderTypePillClass(orderTypeLabel)}`}
                                  >
                                    {OrderTypeIcon ? <OrderTypeIcon className="h-3 w-3 mr-1" /> : null}
                                    {orderTypeDisplay}
                                  </span>
                                </TableCell>
                                {orderColumns.size && (
                                  <TableCell className="whitespace-nowrap">{order.lots} lots</TableCell>
                                )}
                                {orderColumns.prices && (
                                  <TableCell className="font-mono tabular-nums whitespace-nowrap">
                                    {formatPx(orderPrice, orderSymbol)}
                                  </TableCell>
                                )}
                                {orderColumns.tpSl && (
                                  <>
                                    <TableCell className="whitespace-nowrap">
                                      {renderTargetPill("TP", order.takeProfit, orderSymbol, order.type, entry)}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap">
                                      {renderTargetPill("SL", order.stopLoss, orderSymbol, order.type, entry)}
                                    </TableCell>
                                  </>
                                )}
                                {orderColumns.actions && (
                                  <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex gap-1 justify-end">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className={editIconButtonClass}
                                        onClick={() => setEditingTrade(order)}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => cancelOrder.mutate(order.id)}
                                        disabled={cancelOrder.isPending}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                )}
                                {hasHiddenOrderColumns && (
                                  <TableCell className="w-8 text-gray-400">
                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </TableCell>
                                )}
                              </TableRow>
                              {/* Expandable details for hidden columns */}
                              {isExpanded && hasHiddenOrderColumns && (
                                <TableRow key={`${order.id}-expanded`} className="bg-neutral-850">
                                  <TableCell colSpan={100} className="py-3">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                      {!orderColumns.size && (
                                        <div>
                                          <span className="text-gray-500 text-xs">Size</span>
                                          <div className="text-white">{order.lots} lots</div>
                                        </div>
                                      )}
                                      {!orderColumns.prices && (
                                        <div>
                                          <span className="text-gray-500 text-xs">Order Price</span>
                                          <div className="text-white font-mono">{formatPx(orderPrice, orderSymbol)}</div>
                                        </div>
                                      )}
                                      {!orderColumns.tpSl && (
                                        <>
                                          <div>
                                            <span className="text-gray-500 text-xs">Take Profit</span>
                                            <div>{renderTargetPill("TP", order.takeProfit, orderSymbol, order.type, entry)}</div>
                                          </div>
                                          <div>
                                            <span className="text-gray-500 text-xs">Stop Loss</span>
                                            <div>{renderTargetPill("SL", order.stopLoss, orderSymbol, order.type, entry)}</div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                    {/* Show actions in expanded section when hidden from table */}
                                    {!orderColumns.actions && (
                                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-700">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className={`flex-1 ${editIconButtonClass}`}
                                          onClick={(e) => { e.stopPropagation(); setEditingTrade(order); }}
                                        >
                                          <Pencil className="h-3 w-3 mr-1" /> Edit
                                        </Button>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          className="flex-1"
                                          onClick={(e) => { e.stopPropagation(); cancelOrder.mutate(order.id); }}
                                          disabled={cancelOrder.isPending}
                                        >
                                          Cancel
                                        </Button>
                                      </div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              )}
                            </>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
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
