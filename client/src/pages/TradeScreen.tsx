import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { getPipSize, getQuoteDecimals } from "@shared/pips";

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

function accountValueToneClass(value: number | null | undefined, baseline: number | null): string {
  if (!Number.isFinite(Number(value)) || baseline == null) return "text-white";
  if (Number(value) > baseline) return "text-green-400";
  if (Number(value) < baseline) return "text-red-400";
  return "text-white";
}

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
  const { lotDropdownMax, lotDropdownOptions, lotPresetCards, minPriceDistancePips } = useLotSettings();
  const { bundle } = useTranslation();
  const { quotes } = useQuotes();
  const currentQuote = quotes?.find(q => q.symbol === selectedSymbol);
  const { openTrades = [], isLoadingOpenTrades, closeTrade } = useTrades();
  const { summary: accountSummary, isLoading: isLoadingAccountSummary } = useAccountSummary();
  const { pendingOrders = [], isLoading: isLoadingPending, cancelOrder } = usePendingOrders();
  const openTradesCount = Array.isArray(openTrades) ? openTrades.length : 0;
  const pendingOrdersCount = Array.isArray(pendingOrders) ? pendingOrders.length : 0;
  const startingAccountBalance = useMemo(() => {
    const fromSummary = Number(accountSummary?.startingBalance);
    if (Number.isFinite(fromSummary) && fromSummary > 0) return fromSummary;
    const fromUser = Number((user as any)?.startingEquity);
    if (Number.isFinite(fromUser) && fromUser > 0) return fromUser;
    return null;
  }, [accountSummary?.startingBalance, user]);
  const balanceToneClass = accountValueToneClass(accountSummary?.balance, startingAccountBalance);
  const equityToneClass = accountValueToneClass(accountSummary?.equity, startingAccountBalance);

  // Collapse the fixed header on mobile when the main tab content scrolls.
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [collapseHeaderOnMobile, setCollapseHeaderOnMobile] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const headerShellRef = useRef<HTMLDivElement>(null);
  const headerExpandedRef = useRef<HTMLDivElement>(null);
  const headerCompactRef = useRef<HTMLButtonElement>(null);
  const headerHeightsRef = useRef({ expanded: 0, compact: 0, distance: 120 });
  const headerAppliedRef = useRef({ progress: -1, height: -1 });
  const headerMeasureRafRef = useRef<number | null>(null);
  const headerLastScrollTopRef = useRef(0);
  const headerForceExpandRef = useRef(false);
  const headerLockedCollapsedRef = useRef(false);

  // Container width detection for responsive table (ResizeObserver-based, not pixel breakpoints)
  const positionsContainerRef = useRef<HTMLDivElement>(null);
  const ordersContainerRef = useRef<HTMLDivElement>(null);
  const positionsTableRef = useRef<HTMLTableElement>(null);
  const ordersTableRef = useRef<HTMLTableElement>(null);
  const positionsColumnTuneTimeoutRef = useRef<number | null>(null);
  const ordersColumnTuneTimeoutRef = useRef<number | null>(null);
  // Use window.innerWidth as initial estimate (will be refined by ResizeObserver)
  const [positionsContainerWidth, setPositionsContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? Math.round(window.innerWidth) : 1200
  );
  const [ordersContainerWidth, setOrdersContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? Math.round(window.innerWidth) : 1200
  );

  type PositionColumnState = {
    actions: boolean;
    size: boolean;
    tpSl: boolean;
    prices: boolean;
    time: boolean;
  };
  type OrderColumnState = {
    actions: boolean;
    size: boolean;
    tpSl: boolean;
    prices: boolean;
  };

  const getPositionColumnsForWidth = (width: number): PositionColumnState => {
    if (width < 900) {
      return { actions: false, size: false, tpSl: false, prices: false, time: false };
    }
    if (width < 1100) {
      return { actions: false, size: true, tpSl: false, prices: false, time: false };
    }
    if (width < 1300) {
      return { actions: true, size: true, tpSl: false, prices: true, time: false };
    }
    return { actions: true, size: true, tpSl: true, prices: true, time: true };
  };

  const getOrderColumnsForWidth = (width: number): OrderColumnState => {
    if (width < 900) {
      return { actions: false, size: false, tpSl: false, prices: false };
    }
    if (width < 1080) {
      return { actions: false, size: true, tpSl: false, prices: false };
    }
    if (width < 1260) {
      return { actions: true, size: true, tpSl: false, prices: true };
    }
    return { actions: true, size: true, tpSl: true, prices: true };
  };

  const samePositionColumns = (a: PositionColumnState, b: PositionColumnState) =>
    a.actions === b.actions
    && a.size === b.size
    && a.tpSl === b.tpSl
    && a.prices === b.prices
    && a.time === b.time;

  const sameOrderColumns = (a: OrderColumnState, b: OrderColumnState) =>
    a.actions === b.actions
    && a.size === b.size
    && a.tpSl === b.tpSl
    && a.prices === b.prices;

  const [positionColumns, setPositionColumns] = useState<PositionColumnState>(() =>
    getPositionColumnsForWidth(typeof window !== "undefined" ? Math.round(window.innerWidth) : 1200)
  );
  const [orderColumns, setOrderColumns] = useState<OrderColumnState>(() =>
    getOrderColumnsForWidth(typeof window !== "undefined" ? Math.round(window.innerWidth) : 1200)
  );

  const positionColumnsRef = useRef(positionColumns);
  const orderColumnsRef = useRef(orderColumns);
  const positionsWidthRef = useRef(positionsContainerWidth);
  const ordersWidthRef = useRef(ordersContainerWidth);

  const handleTradeTabChange = (nextTab: string) => {
    if (nextTab === "active-positions") {
      const width = Math.max(
        0,
        Math.round(
          positionsContainerRef.current?.clientWidth
          ?? positionsWidthRef.current
          ?? window.innerWidth
        ),
      );
      const preset = getPositionColumnsForWidth(width);
      setPositionColumns((prevState) => (samePositionColumns(prevState, preset) ? prevState : preset));
    } else if (nextTab === "pending-orders") {
      const width = Math.max(
        0,
        Math.round(
          ordersContainerRef.current?.clientWidth
          ?? ordersWidthRef.current
          ?? window.innerWidth
        ),
      );
      const preset = getOrderColumnsForWidth(width);
      setOrderColumns((prevState) => (sameOrderColumns(prevState, preset) ? prevState : preset));
    }
    setActiveTab(nextTab);
  };

  // Check if there are any hidden columns (for showing expand chevron)
  // Show chevron when any column (including actions) is hidden
  const hasHiddenPositionColumns =
    !positionColumns.actions
    || !positionColumns.size
    || !positionColumns.tpSl
    || !positionColumns.prices
    || !positionColumns.time;
  const hasHiddenOrderColumns =
    !orderColumns.actions
    || !orderColumns.size
    || !orderColumns.tpSl
    || !orderColumns.prices;

  // Expandable row state
  const [expandedPositionRows, setExpandedPositionRows] = useState<Set<number>>(new Set());
  const [expandedOrderRows, setExpandedOrderRows] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!hasHiddenPositionColumns) {
      setExpandedPositionRows((prev) => (prev.size ? new Set() : prev));
    }
  }, [hasHiddenPositionColumns]);

  useEffect(() => {
    if (!hasHiddenOrderColumns) {
      setExpandedOrderRows((prev) => (prev.size ? new Set() : prev));
    }
  }, [hasHiddenOrderColumns]);

  useEffect(() => {
    positionColumnsRef.current = positionColumns;
  }, [positionColumns]);

  useEffect(() => {
    orderColumnsRef.current = orderColumns;
  }, [orderColumns]);

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
        const width = Math.max(0, Math.round(entry.contentRect.width));
        if (width === positionsWidthRef.current) continue;
        positionsWidthRef.current = width;
        setPositionsContainerWidth(width);
      }
    });

    observer.observe(container);
    const width = Math.max(0, Math.round(container.clientWidth));
    positionsWidthRef.current = width;
    setPositionsContainerWidth(width);

    return () => observer.disconnect();
  }, [activeTab]);

  // ResizeObserver for orders container
  useEffect(() => {
    const container = ordersContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.max(0, Math.round(entry.contentRect.width));
        if (width === ordersWidthRef.current) continue;
        ordersWidthRef.current = width;
        setOrdersContainerWidth(width);
      }
    });

    observer.observe(container);
    const width = Math.max(0, Math.round(container.clientWidth));
    ordersWidthRef.current = width;
    setOrdersContainerWidth(width);

    return () => observer.disconnect();
  }, [activeTab]);

  // Window resize fallback for tabs that haven't been visited yet
  useEffect(() => {
    const handleResize = () => {
      // Use container width if available, otherwise use window width
      if (positionsContainerRef.current) {
        const width = Math.max(0, Math.round(positionsContainerRef.current.clientWidth));
        if (width !== positionsWidthRef.current) {
          positionsWidthRef.current = width;
          setPositionsContainerWidth(width);
        }
      } else {
        const width = Math.max(0, Math.round(window.innerWidth));
        if (width !== positionsWidthRef.current) {
          positionsWidthRef.current = width;
          setPositionsContainerWidth(width);
        }
      }
      if (ordersContainerRef.current) {
        const width = Math.max(0, Math.round(ordersContainerRef.current.clientWidth));
        if (width !== ordersWidthRef.current) {
          ordersWidthRef.current = width;
          setOrdersContainerWidth(width);
        }
      } else {
        const width = Math.max(0, Math.round(window.innerWidth));
        if (width !== ordersWidthRef.current) {
          ordersWidthRef.current = width;
          setOrdersContainerWidth(width);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mobile breakpoint detection (keeps the header dense on desktop).
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setCollapseHeaderOnMobile(mql.matches);
    update();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }

    // Safari legacy API
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const smoothstep = (edge0: number, edge1: number, x: number) => {
    const denom = Math.max(1e-6, edge1 - edge0);
    const t = clamp01((x - edge0) / denom);
    return t * t * (3 - 2 * t);
  };

  const applyTradeHeaderCollapse = (scrollTop: number) => {
    const shell = headerShellRef.current;
    const expandedEl = headerExpandedRef.current;
    const compactEl = headerCompactRef.current;
    if (!shell || !expandedEl || !compactEl) return;

    if (!collapseHeaderOnMobile) {
      headerLockedCollapsedRef.current = false;
      shell.style.height = "";
      expandedEl.style.opacity = "";
      expandedEl.style.transform = "";
      expandedEl.style.pointerEvents = "";

      compactEl.style.opacity = "0";
      compactEl.style.transform = "";
      compactEl.style.pointerEvents = "none";
      return;
    }

    const { expanded, compact, distance } = headerHeightsRef.current;
    if (!expanded || !compact) return;

    const prevScrollTop = headerLastScrollTopRef.current;
    headerLastScrollTopRef.current = scrollTop;

    const prevAppliedRaw = headerAppliedRef.current.progress;
    const prevApplied = prevAppliedRaw >= 0 ? prevAppliedRaw : 0;

    let progress = 0;

    if (headerForceExpandRef.current) {
      headerForceExpandRef.current = false;
      headerLockedCollapsedRef.current = false;
      progress = 0;
    } else if (headerLockedCollapsedRef.current) {
      progress = 1;
    } else {
      const raw = scrollTop / Math.max(1, distance);
      progress = clamp01(raw);

      // If collapsing the header makes the container non-scrollable, browsers can clamp `scrollTop`
      // back to 0. Don't interpret that as "user scrolled to top" or we can get an oscillation.
      const scrollEl = tabScrollRef.current;
      if (scrollEl) {
        const overflowNow = scrollEl.scrollHeight - scrollEl.clientHeight;
        if (scrollTop === 0 && prevScrollTop > 0 && overflowNow <= 0 && prevApplied > 0) {
          // If collapsing makes the tab body fully fit, browsers can clamp `scrollTop` back to 0.
          // Treat this as "fully collapsed" so tall screens don't need multiple scroll gestures.
          progress = 1;
        }
      }
    }

    if (!headerLockedCollapsedRef.current) {
      // Snap with hysteresis at extremes to avoid boundary flicker.
      const prevProgress = headerAppliedRef.current.progress;
      const snapTopIn = 0.02;
      const snapTopOut = 0.08;
      const snapBottomIn = 0.94;
      const snapBottomOut = 0.86;

      if (prevProgress === 0 && progress < snapTopOut) {
        progress = 0;
      } else if (prevProgress === 1 && progress > snapBottomOut) {
        progress = 1;
      } else {
        if (progress < snapTopIn) progress = 0;
        if (progress > snapBottomIn) progress = 1;
      }

      if (progress >= 1) {
        headerLockedCollapsedRef.current = true;
      }
    }

    const height = Math.round(expanded - progress * (expanded - compact));
    const prev = headerAppliedRef.current;
    if (Math.abs(prev.height - height) <= 1 && Math.abs(prev.progress - progress) < 0.005) return;
    headerAppliedRef.current = { progress, height };

    shell.style.height = `${height}px`;
    const expandedOpacity = 1 - smoothstep(0.25, 0.7, progress);
    const compactOpacity = smoothstep(0.55, 0.9, progress);

    expandedEl.style.opacity = `${expandedOpacity}`;
    expandedEl.style.transform = `translateY(${Math.round(-progress * 8)}px) translateZ(0)`;
    expandedEl.style.pointerEvents = expandedOpacity < 0.05 ? "none" : "auto";

    compactEl.style.opacity = `${compactOpacity}`;
    compactEl.style.transform = `translateY(${Math.round((1 - compactOpacity) * 8)}px) translateZ(0)`;
    compactEl.style.pointerEvents = compactOpacity < 0.35 ? "none" : "auto";
  };

  const measureTradeHeaderHeights = () => {
    const expandedEl = headerExpandedRef.current;
    const compactEl = headerCompactRef.current;
    if (!expandedEl || !compactEl) return;

    // Round to avoid subpixel jitter across resize/layout changes.
    const expanded = Math.max(0, Math.round(expandedEl.scrollHeight));
    const compact = Math.max(0, Math.round(compactEl.scrollHeight));
    if (!expanded || !compact) return;

    const collapseRange = Math.max(0, expanded - compact);
    const distance = Math.max(72, Math.round(collapseRange * 0.5));
    const prev = headerHeightsRef.current;
    const heightsChanged = prev.expanded !== expanded || prev.compact !== compact || prev.distance !== distance;
    if (heightsChanged) {
      // Only invalidate applied state if heights changed meaningfully (prevents flicker from minor variations)
      const needsReset = Math.abs(prev.expanded - expanded) > 2 || Math.abs(prev.compact - compact) > 2;
      headerHeightsRef.current = { expanded, compact, distance };
      if (needsReset) {
        headerAppliedRef.current = { progress: -1, height: -1 };
      }
    }
    applyTradeHeaderCollapse(tabScrollRef.current?.scrollTop ?? 0);
  };

  const scheduleMeasureTradeHeaderHeights = () => {
    if (headerMeasureRafRef.current !== null) return;
    headerMeasureRafRef.current = window.requestAnimationFrame(() => {
      headerMeasureRafRef.current = null;
      measureTradeHeaderHeights();
    });
  };

  useLayoutEffect(() => {
    const shell = headerShellRef.current;
    const expandedEl = headerExpandedRef.current;
    const compactEl = headerCompactRef.current;
    if (!shell || !expandedEl || !compactEl) return;

    // Measure synchronously so the first user scroll doesn't "fight" an unmeasured header.
    measureTradeHeaderHeights();
    scheduleMeasureTradeHeaderHeights();
  }, [
    collapseHeaderOnMobile,
    selectedSymbol,
    currentQuote?.name,
    Boolean(accountSummary),
    isLoadingAccountSummary,
  ]);

  // Keep header heights in sync across responsive wraps (prevents "no man's land" clipping on resize).
  useLayoutEffect(() => {
    if (!collapseHeaderOnMobile) return;

    const expandedEl = headerExpandedRef.current;
    const compactEl = headerCompactRef.current;
    if (!expandedEl || !compactEl) return;

    const observer = new ResizeObserver(() => scheduleMeasureTradeHeaderHeights());
    observer.observe(expandedEl);
    observer.observe(compactEl);
    scheduleMeasureTradeHeaderHeights();

    return () => {
      observer.disconnect();
      if (headerMeasureRafRef.current !== null) {
        window.cancelAnimationFrame(headerMeasureRafRef.current);
        headerMeasureRafRef.current = null;
      }
    };
  }, [collapseHeaderOnMobile]);

  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;

    let rafId: number | null = null;

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        applyTradeHeaderCollapse(el.scrollTop);
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    applyTradeHeaderCollapse(el.scrollTop);

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [activeTab, collapseHeaderOnMobile]);

  // Fit table columns to available width (fluid, content-aware).
  useLayoutEffect(() => {
    if (activeTab !== "active-positions") return;
    if (isLoadingOpenTrades) return;
    if (!Array.isArray(openTrades) || openTrades.length === 0) return;

    const effectiveWidth = positionsContainerWidth > 0
      ? positionsContainerWidth
      : (typeof window !== "undefined" ? Math.round(window.innerWidth) : 1200);

    if (effectiveWidth < 1100) {
      const preset = getPositionColumnsForWidth(effectiveWidth);
      setPositionColumns((prevState) => (samePositionColumns(prevState, preset) ? prevState : preset));
      return;
    }

    let cancelled = false;
    const nextPaint = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    const run = async () => {
      const table = positionsTableRef.current;
      const container = positionsContainerRef.current;
      if (!table || !container) return;

      const getAvailableWidth = () => table.parentElement?.clientWidth ?? container.clientWidth;
      const all: PositionColumnState = { actions: true, size: true, tpSl: true, prices: true, time: true };
      const showOrder: Array<keyof PositionColumnState> = ["actions", "size", "tpSl", "prices", "time"];
      const hideOrder: Array<keyof PositionColumnState> = [...showOrder].reverse();

      let next = positionColumnsRef.current ?? all;
      await nextPaint();
      if (cancelled) return;

      const fits = () => {
        const available = getAvailableWidth();
        return table.scrollWidth <= available + 1;
      };

      // 1) If overflowing, hide least-important columns until it fits.
      if (!fits()) {
        for (const key of hideOrder) {
          if (next[key] === false) continue;
          next = { ...next, [key]: false };
          setPositionColumns((prevState) => (samePositionColumns(prevState, next) ? prevState : next));
          await nextPaint();
          if (cancelled) return;
          if (fits()) break;
        }
      }

      // 2) If it fits, try adding columns back (most-important first) until it overflows.
      if (fits()) {
        for (const key of showOrder) {
          if (next[key] === true) continue;
          const candidate = { ...next, [key]: true };
          setPositionColumns((prevState) => (samePositionColumns(prevState, candidate) ? prevState : candidate));
          await nextPaint();
          if (cancelled) return;
          if (!fits()) {
            // Revert last change if it caused overflow.
            next = { ...next, [key]: false };
            setPositionColumns((prevState) => (samePositionColumns(prevState, next) ? prevState : next));
            await nextPaint();
            break;
          }
          next = candidate;
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (positionsColumnTuneTimeoutRef.current !== null) {
        window.clearTimeout(positionsColumnTuneTimeoutRef.current);
        positionsColumnTuneTimeoutRef.current = null;
      }
    };
  }, [activeTab, positionsContainerWidth, isLoadingOpenTrades, openTradesCount]);

  useLayoutEffect(() => {
    if (activeTab !== "pending-orders") return;
    if (isLoadingPending) return;
    if (!Array.isArray(pendingOrders) || pendingOrders.length === 0) return;

    const effectiveWidth = ordersContainerWidth > 0
      ? ordersContainerWidth
      : (typeof window !== "undefined" ? Math.round(window.innerWidth) : 1200);

    if (effectiveWidth < 1080) {
      const preset = getOrderColumnsForWidth(effectiveWidth);
      setOrderColumns((prevState) => (sameOrderColumns(prevState, preset) ? prevState : preset));
      return;
    }

    let cancelled = false;
    const nextPaint = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    const run = async () => {
      const table = ordersTableRef.current;
      const container = ordersContainerRef.current;
      if (!table || !container) return;

      const getAvailableWidth = () => table.parentElement?.clientWidth ?? container.clientWidth;
      const all: OrderColumnState = { actions: true, size: true, tpSl: true, prices: true };
      const showOrder: Array<keyof OrderColumnState> = ["actions", "size", "prices", "tpSl"];
      const hideOrder: Array<keyof OrderColumnState> = [...showOrder].reverse();

      let next = orderColumnsRef.current ?? all;
      await nextPaint();
      if (cancelled) return;

      const fits = () => {
        const available = getAvailableWidth();
        return table.scrollWidth <= available + 1;
      };

      if (!fits()) {
        for (const key of hideOrder) {
          if (next[key] === false) continue;
          next = { ...next, [key]: false };
          setOrderColumns((prevState) => (sameOrderColumns(prevState, next) ? prevState : next));
          await nextPaint();
          if (cancelled) return;
          if (fits()) break;
        }
      }

      if (fits()) {
        for (const key of showOrder) {
          if (next[key] === true) continue;
          const candidate = { ...next, [key]: true };
          setOrderColumns((prevState) => (sameOrderColumns(prevState, candidate) ? prevState : candidate));
          await nextPaint();
          if (cancelled) return;
          if (!fits()) {
            next = { ...next, [key]: false };
            setOrderColumns((prevState) => (sameOrderColumns(prevState, next) ? prevState : next));
            await nextPaint();
            break;
          }
          next = candidate;
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (ordersColumnTuneTimeoutRef.current !== null) {
        window.clearTimeout(ordersColumnTuneTimeoutRef.current);
        ordersColumnTuneTimeoutRef.current = null;
      }
    };
  }, [activeTab, ordersContainerWidth, isLoadingPending, pendingOrdersCount]);

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
    category?: string | null;
    baseCurrency?: string;
    quoteCurrency?: string;
    spread?: number;
    minSpreadPips: number;
    pipDecimals?: number | null;
    quoteDecimals?: number | null;
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
    grossProfitUsd?: number | null;
    netProfitUsd?: number | null;
    notionalUsd?: number | null;
    totalCostsUsd?: number | null;
    openCommissionUsd?: number | null;
    closeCommissionUsd?: number | null;
    openOtherFeesUsd?: number | null;
    closeOtherFeesUsd?: number | null;
    financingAccruedUsd?: number | null;
    swapAccruedUsd?: number | null;
    overnightDays?: number | null;
    categorySnapshot?: string | null;
    costModelVersion?: string | null;
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

  const symbolCfgBySymbol = useMemo(() => new Map(symbols.map((s) => [s.symbol, s])), [symbols]);

  const selectedSymbolConfig = symbolCfgBySymbol.get(selectedSymbol);

  const selectedPipCfg = useMemo(
    () => ({
      symbol: selectedSymbol,
      category: selectedSymbolConfig?.category,
      quoteCurrency: selectedSymbolConfig?.quoteCurrency,
      pipDecimals: selectedSymbolConfig?.pipDecimals,
      quoteDecimals: selectedSymbolConfig?.quoteDecimals,
    }),
    [
      selectedSymbol,
      selectedSymbolConfig?.category,
      selectedSymbolConfig?.quoteCurrency,
      selectedSymbolConfig?.pipDecimals,
      selectedSymbolConfig?.quoteDecimals,
    ],
  );

  const pipSize = getPipSize(selectedPipCfg);
  const priceDecimals = getQuoteDecimals(selectedPipCfg);

  // Calculate bid/ask prices with minimum 2 pip spread (moved early for useEffect dependencies)
  const minSpreadPips = selectedSymbolConfig?.minSpreadPips || 2.0;
  const minSpread = minSpreadPips * pipSize;

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
    const cfg = symbolCfgBySymbol.get(symbol);
    const decimals = getQuoteDecimals({
      symbol,
      category: cfg?.category,
      quoteCurrency: cfg?.quoteCurrency,
      pipDecimals: cfg?.pipDecimals,
      quoteDecimals: cfg?.quoteDecimals,
    });
    return n.toFixed(decimals);
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

  // Auto-suggest entry/TP/SL prices for pending orders.
  useEffect(() => {
    if (orderType === "Market" || !askPrice || !bidPrice) return;
    const decimals = priceDecimals;
    const minDist = minPriceDistancePips * pipSize;
    // Guard against client/server quote skew (e.g., mid vs bid/ask, jittery feeds).
    // This keeps the autosuggested entry safely beyond the server minimum.
    const entryGuard = Math.max(0, spread || 0);

    const factor = Math.pow(10, decimals);
    const roundUp = (v: number) => Math.ceil(v * factor) / factor;
    const roundDown = (v: number) => Math.floor(v * factor) / factor;

    const setFieldIfChanged = (name: keyof TradeFormValues, value: number) => {
      const next = value.toFixed(decimals);
      const prev = String(form.getValues(name) ?? "");
      if (prev === next) return;
      form.setValue(name, next);
    };

    if (orderType === "Limit" && autoEntry) {
      const raw = pendingSide === "BUY"
        ? (askPrice - (minDist + entryGuard))
        : (bidPrice + (minDist + entryGuard));
      const price = pendingSide === "BUY" ? roundDown(raw) : roundUp(raw);
      setFieldIfChanged("limitPrice", price);
    }
    if (orderType === "Stop" && autoEntry) {
      const raw = pendingSide === "BUY"
        ? (askPrice + (minDist + entryGuard))
        : (bidPrice - (minDist + entryGuard));
      const price = pendingSide === "BUY" ? roundUp(raw) : roundDown(raw);
      setFieldIfChanged("stopPrice", price);
    }

    const entryStr = orderType === "Limit" ? form.getValues("limitPrice") : form.getValues("stopPrice");
    const entry = parseFloat(entryStr || "0");
    if (entry > 0) {
      if (autoTp) {
        const rawTp = pendingSide === "BUY" ? entry + minDist : entry - minDist;
        const tp = pendingSide === "BUY" ? roundUp(rawTp) : roundDown(rawTp);
        setFieldIfChanged("takeProfit", tp);
      }
      if (autoSl) {
        const rawSl = pendingSide === "BUY" ? entry - minDist : entry + minDist;
        const sl = pendingSide === "BUY" ? roundDown(rawSl) : roundUp(rawSl);
        setFieldIfChanged("stopLoss", sl);
      }
    }
  }, [askPrice, bidPrice, orderType, pendingSide, autoEntry, autoTp, autoSl, priceDecimals, pipSize, selectedSymbol, spread, minPriceDistancePips, form]);

  // If the user edits a pending entry price, keep TP/SL aligned (prevents "submit before next tick" rejections).
  useLayoutEffect(() => {
    if (orderType === "Market") return;
    if (!autoTp && !autoSl) return;

    const decimals = priceDecimals;
    const minDist = minPriceDistancePips * pipSize;
    const factor = Math.pow(10, decimals);
    const roundUp = (v: number) => Math.ceil(v * factor) / factor;
    const roundDown = (v: number) => Math.floor(v * factor) / factor;

    const entryField = orderType === "Limit" ? "limitPrice" : "stopPrice";
    const subscription = form.watch((values, meta) => {
      if (meta.name !== entryField) return;
      const rawEntry = values?.[entryField];
      const entry = typeof rawEntry === "string" ? Number(rawEntry) : Number.NaN;
      if (!Number.isFinite(entry) || entry <= 0) return;

      const setFieldIfChanged = (name: keyof TradeFormValues, value: number) => {
        const next = value.toFixed(decimals);
        const prev = String(form.getValues(name) ?? "");
        if (prev === next) return;
        form.setValue(name, next);
      };

      if (autoTp) {
        const rawTp = pendingSide === "BUY" ? entry + minDist : entry - minDist;
        const tp = pendingSide === "BUY" ? roundUp(rawTp) : roundDown(rawTp);
        setFieldIfChanged("takeProfit", tp);
      }
      if (autoSl) {
        const rawSl = pendingSide === "BUY" ? entry - minDist : entry + minDist;
        const sl = pendingSide === "BUY" ? roundDown(rawSl) : roundUp(rawSl);
        setFieldIfChanged("stopLoss", sl);
      }
    });

    return () => subscription.unsubscribe();
  }, [autoSl, autoTp, form, orderType, pendingSide, priceDecimals, pipSize, selectedSymbol, minPriceDistancePips]);

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
    // For pending orders, use pendingSide; for market orders, use tradeDirection
    const effectiveDirection = orderType === "Market" ? tradeDirection : pendingSide;

    if (!effectiveDirection || !selectedSymbolConfig) {
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
    <div className="tq-trade-screen h-full flex flex-col bg-neutral-900 overflow-hidden @container/trade" style={{ containerType: 'inline-size', containerName: 'trade' }}>
      {/* Symbol info header */}
      <div
        ref={headerShellRef}
        data-testid="trade-header-shell"
        className="tq-trade-header-shell border-b border-gray-800 shrink-0 relative overflow-hidden"
        style={{ willChange: collapseHeaderOnMobile ? "height" : undefined }}
      >
        {/* Compact overlay (fades/slides in progressively as the tab content scrolls) */}
	          <button
	            ref={headerCompactRef}
	            type="button"
	          onClick={() => {
	            headerForceExpandRef.current = true;
	            tabScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
	            applyTradeHeaderCollapse(0);
	          }}
	            className="tq-trade-header-compact absolute inset-x-0 top-0 z-10 w-full px-3 sm:px-gutter py-2 text-left hover:bg-white/[0.02] transition-colors opacity-0 pointer-events-none"
	            aria-label="Scroll to top to expand market and account details"
	            style={{ willChange: "opacity, transform", backfaceVisibility: "hidden" }}
	          >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-primary">{selectedSymbol}</span>
                {currentPrice ? (
                  <span className="text-sm font-mono text-white/90">
                    {currentPrice.toFixed(priceDecimals)}
                  </span>
                ) : (
                  <span className="text-sm text-gray-500">—</span>
                )}
                {currentQuote?.changePct !== undefined ? (
                  <span
                    className={`text-xs font-mono ${currentQuote.changePct >= 0 ? "text-success-500" : "text-danger-500"}`}
                  >
                    {currentQuote.changePct >= 0 ? "+" : ""}
                    {currentQuote.changePct.toFixed(2)}%
                  </span>
                ) : null}
              </div>
	              <div className="mt-0.5 text-[11px] text-gray-400 font-mono overflow-x-auto whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
	                {accountSummary ? (
	                  <>
	                    Eq:{" "}
                      <span className={equityToneClass}>
                        ${accountSummary.equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>{" "}
	                    | FM: ${accountSummary.freeMargin.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
	                    | UM: ${accountSummary.usedMargin.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
	                    | Bal:{" "}
                      <span className={balanceToneClass}>
                        ${accountSummary.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
	                  </>
	                ) : (
	                  <>
	                    Account:{" "}
                    {isLoadingAccountSummary ? "Loading…" : "—"}
                  </>
                )}
              </div>
            </div>
            <ChevronDown className="h-4 w-4 text-gray-500 shrink-0" />
          </div>
        </button>

        {/* Full header (shrinks progressively; clipped by the shell height) */}
        <div
          ref={headerExpandedRef}
          className="tq-trade-header-expanded px-3 sm:px-gutter py-3 sm:py-4"
          style={{ willChange: "opacity, transform", backfaceVisibility: "hidden" }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:gap-x-8 gap-y-2 items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-start gap-x-3 sm:gap-x-8 gap-y-2 sm:gap-y-3">
                <div className="min-w-0">
                  {currentQuote ? (
                    <>
                      <h3 className="font-semibold text-primary text-[clamp(0.875rem,0.8rem+0.35cqi,1rem)]">{selectedSymbol}</h3>
                    </>
                  ) : (
                    <Skeleton className="h-6 w-24" />
                  )}
                </div>

                {/* Bid/Ask/Spread row (wraps below symbol when space is tight; moves inline when space allows) */}
                <div className="grid w-full grid-cols-3 gap-x-2.5 sm:gap-x-6 gap-y-1">
                  <div className="flex flex-col min-w-0">
                    <span className="text-cq-xs text-gray-400">Bid</span>
                    {bidPrice ? (
                      <span className="font-mono text-[0.8rem] sm:text-[0.875rem] leading-tight text-danger-500 truncate">
                        {bidPrice.toFixed(priceDecimals)}
                      </span>
                    ) : (
                      <Skeleton className="h-4 w-16" />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-cq-xs text-gray-400">Ask</span>
                    {askPrice ? (
                      <span className="font-mono text-[0.8rem] sm:text-[0.875rem] leading-tight text-success-500 truncate">
                        {askPrice.toFixed(priceDecimals)}
                      </span>
                    ) : (
                      <Skeleton className="h-4 w-16" />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-cq-xs text-gray-400">Spread</span>
                    {spread ? (
                      <span className="font-mono text-[0.8rem] sm:text-[0.875rem] leading-tight text-white truncate">
                        {spread.toFixed(priceDecimals)}
                      </span>
                    ) : (
                      <Skeleton className="h-4 w-16" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="text-right shrink-0">
	              {currentPrice ? (
	                <>
	                  <div className="font-mono font-semibold tabular-nums text-white whitespace-nowrap leading-none text-[clamp(0.9rem,0.85rem+0.6cqi,1.25rem)]">
	                    {currentPrice.toFixed(priceDecimals)}
	                  </div>
                  <div className={`font-mono text-[0.72rem] sm:text-[0.8rem] leading-tight ${currentQuote?.changePct && currentQuote.changePct >= 0
                    ? "text-success-500"
                    : "text-danger-500"}`}>
                    {currentQuote?.changePct && currentQuote.changePct >= 0 ? "+" : ""}
                    {currentQuote?.changePct !== undefined ? currentQuote.changePct.toFixed(2) : "0.00"}%
                    <span className="cq-hide-narrow">{" "}today</span>
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

          {/* Account metrics - responsive grid with real-time data */}
          <div className="w-full mt-4">
            <span className="text-xs text-gray-400 mb-1 block">Account</span>
            <div className="tq-trade-account-strip grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 bg-neutral-800 p-2 rounded-md">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-gray-500">Balance</span>
                {accountSummary ? (
                  <span className={`font-mono text-xs truncate ${balanceToneClass}`}>
                    ${accountSummary.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </div>

              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-gray-500">Equity</span>
                {accountSummary ? (
                  <span className={`font-mono text-xs truncate ${equityToneClass}`}>
                    ${accountSummary.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </div>

              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-gray-500">Free Margin</span>
                {accountSummary ? (
                  <span className="font-mono text-white text-xs truncate">
                    ${accountSummary.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </div>

              <div className="flex flex-col min-w-0">
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

      {/* Main tabbed content area */}
      <div
        ref={tabScrollRef}
        data-testid="trade-tab-scroll"
        className="flex-1 min-h-0 overflow-auto overscroll-contain"
        style={{ scrollbarGutter: "stable", overflowAnchor: "none" }}
      >
	        <Tabs
	          value={activeTab}
	          onValueChange={handleTradeTabChange}
	          className="w-full min-h-full flex flex-col"
	        >
		          <TabsList className="tq-trade-tabs w-full grid grid-cols-3 rounded-none bg-neutral-800 shrink-0 sticky top-0 z-20 border-b border-gray-800">
	            <TabsTrigger
	              value="place-order"
	              aria-label="Place Order"
	              className="tq-trade-tab data-[state=active]:bg-neutral-700 rounded-none text-cq-sm px-1"
	            >
              <span className="cq-hide-narrow">Place Order</span>
              <span className="cq-show-narrow-only">Order</span>
            </TabsTrigger>
            <TabsTrigger
              value="active-positions"
              aria-label="Active Positions"
              className="tq-trade-tab data-[state=active]:bg-neutral-700 rounded-none text-cq-sm px-1"
            >
              <span className="cq-hide-narrow">Active Positions</span>
              <span className="cq-show-narrow-only">Positions</span>
            </TabsTrigger>
            <TabsTrigger
              value="pending-orders"
              aria-label="Pending Orders"
              className="tq-trade-tab data-[state=active]:bg-neutral-700 rounded-none text-cq-sm px-1"
            >
              <span className="cq-hide-narrow">Pending Orders</span>
              <span className="cq-show-narrow-only">Pending</span>
            </TabsTrigger>
          </TabsList>

          {/* Place Order Tab */}
		          <TabsContent value="place-order" className="p-0 m-0 flex-1 min-h-0">
		            <div className="flex flex-col lg:flex-row h-full min-h-0">
		              {/* Order form */}
		              <div className="w-full flex flex-col h-full min-h-0">
		                <div className="p-4 flex-1 flex flex-col min-h-0">
		                  <Form {...form}>
		                    <form
                          id="trade-order-form"
                          onSubmit={form.handleSubmit(onSubmit)}
                          className="flex flex-col flex-1"
                        >
		                      <div className="space-y-5">
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
                                  className="w-[4.75rem] min-w-[4.75rem] overflow-y-auto bg-neutral-900 border-gray-700"
                                  style={{
                                    // Adaptive viewport fit: keeps ~3 rows minimum on short screens,
                                    // preserves current desktop max window (~8 visible rows).
                                    maxHeight: "clamp(6.75rem, calc(100dvh - 24rem), 18rem)",
                                  }}
                                >
                                  {lotDropdownOptions.map((lot) => (
                                    <SelectItem
                                      key={lot}
                                      value={lot.toString()}
                                      className="h-9 text-sm text-white hover:bg-neutral-800"
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
                            <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                              {lotPresetCards.map((preset) => {
                                const value = preset.toString();
                                return (
                                  <Button
                                    key={value}
                                    type="button"
                                    variant="outline"
                                    className={`h-9 px-1.5 text-[0.7rem] sm:text-xs leading-none grow shrink basis-[18%] sm:basis-[31%] ${field.value === value
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
                                        ? currentPrice.toFixed(priceDecimals)
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
                                        ? currentPrice.toFixed(priceDecimals)
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
                        <div
                          className="grid gap-3"
                          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(16rem, 100%), 1fr))" }}
                        >
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
                                          ).toFixed(priceDecimals)
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
                                          ).toFixed(priceDecimals)
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

                      </div>

	                    </form>
	                  </Form>
	                </div>
              </div>
            </div>
          </TabsContent>

          {/* Active Positions Tab */}
		          <TabsContent
                forceMount
                value="active-positions"
                className="p-0 m-0 flex-1 min-h-0 data-[state=inactive]:hidden"
              >
	            <div ref={positionsContainerRef} data-testid="trade-active-positions" className="tq-trade-table-wrap p-4">
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
                  <div className="tq-trade-table-shell overflow-x-auto">
                    <Table ref={positionsTableRef} className="tq-trade-table w-full [&_th]:!p-2 [&_td]:!p-2">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Symbol</TableHead>
                          <TableHead className="whitespace-nowrap">Type</TableHead>
                          {positionColumns.size && <TableHead className="whitespace-nowrap">Size</TableHead>}
                          {positionColumns.time && <TableHead className="whitespace-nowrap">Open Time</TableHead>}
                          {positionColumns.prices && (
                            <>
                              <TableHead className="whitespace-nowrap">Open Price</TableHead>
                              <TableHead className="whitespace-nowrap">Current</TableHead>
                            </>
                          )}
                          {positionColumns.tpSl && (
                            <>
                              <TableHead className="whitespace-nowrap">TP</TableHead>
                              <TableHead className="whitespace-nowrap">SL</TableHead>
                            </>
                          )}
                          <TableHead className="whitespace-nowrap">P/L</TableHead>
                          {positionColumns.actions && <TableHead className="text-right whitespace-nowrap">Action</TableHead>}
                          {hasHiddenPositionColumns && <TableHead className="w-8"></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.isArray(openTrades) && openTrades.map((trade: Trade) => {
                          const tradeSymbolConfig = symbols.find(s => s.id === trade.symbolId);
                          const tradeSymbol = tradeSymbolConfig?.symbol || '';
                          const tradeQuote = quotes.find(q => q.symbol === tradeSymbol);
                          const currentTradePrice = tradeQuote?.price || currentPrice;
                          const isJpy = String(tradeSymbolConfig?.quoteCurrency || '').toUpperCase() === 'JPY' || tradeSymbol.includes('JPY');
                          const tradePipSize = getPipSize({
                            symbol: tradeSymbol,
                            category: tradeSymbolConfig?.category,
                            quoteCurrency: tradeSymbolConfig?.quoteCurrency,
                            pipDecimals: tradeSymbolConfig?.pipDecimals,
                            quoteDecimals: tradeSymbolConfig?.quoteDecimals,
                          });
                          const isExpanded = expandedPositionRows.has(trade.id);

                          // Calculate profit/loss using MT4/5-style calculations
                          let pl = 0;
                          if (currentTradePrice) {
                            const contractSize = 100000;
                            const priceDiff = trade.type === 'BUY'
                              ? currentTradePrice - trade.openPrice
                              : trade.openPrice - currentTradePrice;
                            const pips = priceDiff / tradePipSize;

                            if (isJpy) {
                              const pipValueInUsd = (contractSize * tradePipSize) / currentTradePrice;
                              pl = pips * pipValueInUsd * trade.lots;
                            } else {
                              pl = pips * (contractSize * tradePipSize) * trade.lots;
                            }
                          }

                          return (
                            <Fragment key={trade.id}>
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
                                  <TableCell className="text-sm text-gray-400">
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
                              {hasHiddenPositionColumns && (
                                <TableRow
                                  key={`${trade.id}-expanded`}
                                  aria-hidden={!isExpanded}
                                  className={`bg-neutral-850 ${isExpanded ? "" : "hidden"}`}
                                >
                                  <TableCell colSpan={100} className="py-3">
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm sm:gap-x-4">
                                      {!positionColumns.size && (
                                        <div className="min-w-0">
                                          <span className="text-gray-500 text-xs">Size</span>
                                          <div className="text-white">{trade.lots} Lot{trade.lots > 1 ? 's' : ''}</div>
                                        </div>
                                      )}
                                      {!positionColumns.time && (
                                        <div className="min-w-0">
                                          <span className="text-gray-500 text-xs">Open Time</span>
                                          <div className="break-words text-gray-300 text-xs leading-snug">
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
                                          <div className="min-w-0">
                                            <span className="text-gray-500 text-xs">Open Price</span>
                                            <div className="text-white font-mono break-all">{trade.openPrice.toFixed(isJpy ? 2 : 4)}</div>
                                          </div>
                                          <div className="min-w-0">
                                            <span className="text-gray-500 text-xs">Current Price</span>
                                            <div className="text-white font-mono break-all">{currentTradePrice?.toFixed(isJpy ? 2 : 4) || '—'}</div>
                                          </div>
                                        </>
                                      )}
                                      {!positionColumns.tpSl && (
                                        <>
                                          <div className="min-w-0">
                                            <span className="text-gray-500 text-xs">Take Profit</span>
                                            <div className="min-w-0">{renderTargetPill("TP", trade.takeProfit, tradeSymbol, trade.type, trade.openPrice)}</div>
                                          </div>
                                          <div className="min-w-0">
                                            <span className="text-gray-500 text-xs">Stop Loss</span>
                                            <div className="min-w-0">{renderTargetPill("SL", trade.stopLoss, tradeSymbol, trade.type, trade.openPrice)}</div>
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
                            </Fragment>
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
			          <TabsContent
                forceMount
                value="pending-orders"
                className="p-0 m-0 flex-1 min-h-0 data-[state=inactive]:hidden"
              >
	            <div ref={ordersContainerRef} data-testid="trade-pending-orders" className="tq-trade-table-wrap p-4">
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
                  <div className="tq-trade-table-shell overflow-x-auto">
                    <Table ref={ordersTableRef} className="tq-trade-table w-full [&_th]:!p-2 [&_td]:!p-2">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Symbol</TableHead>
                          <TableHead className="whitespace-nowrap">Type</TableHead>
                          <TableHead className="whitespace-nowrap">Order</TableHead>
                          {orderColumns.size && <TableHead className="whitespace-nowrap">Size</TableHead>}
                          {orderColumns.prices && <TableHead className="whitespace-nowrap">Price</TableHead>}
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
                            <Fragment key={order.id}>
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
                              {hasHiddenOrderColumns && (
                                <TableRow
                                  key={`${order.id}-expanded`}
                                  aria-hidden={!isExpanded}
                                  className={`bg-neutral-850 ${isExpanded ? "" : "hidden"}`}
                                >
                                  <TableCell colSpan={100} className="py-3">
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm sm:gap-x-4">
                                      {!orderColumns.size && (
                                        <div className="min-w-0">
                                          <span className="text-gray-500 text-xs">Size</span>
                                          <div className="text-white">{order.lots} lots</div>
                                        </div>
                                      )}
                                      {!orderColumns.prices && (
                                        <div className="min-w-0">
                                          <span className="text-gray-500 text-xs">Order Price</span>
                                          <div className="text-white font-mono break-all">{formatPx(orderPrice, orderSymbol)}</div>
                                        </div>
                                      )}
                                      {!orderColumns.tpSl && (
                                        <>
                                          <div className="min-w-0">
                                            <span className="text-gray-500 text-xs">Take Profit</span>
                                            <div className="min-w-0">{renderTargetPill("TP", order.takeProfit, orderSymbol, order.type, entry)}</div>
                                          </div>
                                          <div className="min-w-0">
                                            <span className="text-gray-500 text-xs">Stop Loss</span>
                                            <div className="min-w-0">{renderTargetPill("SL", order.stopLoss, orderSymbol, order.type, entry)}</div>
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
                            </Fragment>
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

        {activeTab === "place-order" && (
          <div
            className="tq-trade-action-bar shrink-0 border-t border-gray-800 bg-neutral-900 px-3 sm:px-gutter"
            style={{
              paddingTop: "clamp(0.5rem, 1cqi, 0.75rem)",
              paddingBottom: "calc(env(safe-area-inset-bottom) + clamp(0.5rem, 1cqi, 0.75rem))",
            }}
          >
            {orderType !== "Market" ? (
              <Button
                type="submit"
                form="trade-order-form"
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
              <div className="flex gap-3">
                <Button
                  type="submit"
                  form="trade-order-form"
                  className="btn-sell flex-1 min-w-0 py-3 px-4 text-white font-bold bg-orange-500 hover:bg-orange-600 shadow-md transition-all uppercase"
                  disabled={executeTrade.isPending || !currentPrice}
                  onClick={() => setTradeDirection("SELL")}
                >
                  {executeTrade.isPending && tradeDirection === "SELL" ? (
                    <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-white rounded-full"></div>
                  ) : null}
                  {getSideLabel("SELL")}
                  {bidPrice && (
                    <span className="text-xs block">@ {bidPrice.toFixed(priceDecimals)}</span>
                  )}
                </Button>
                <Button
                  type="submit"
                  form="trade-order-form"
                  className="btn-buy flex-1 min-w-0 py-3 px-4 text-black font-bold bg-lime-500 hover:bg-lime-600 shadow-md transition-all uppercase"
                  disabled={executeTrade.isPending || !currentPrice}
                  onClick={() => setTradeDirection("BUY")}
                >
                  {executeTrade.isPending && tradeDirection === "BUY" ? (
                    <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-black rounded-full"></div>
                  ) : null}
                  {getSideLabel("BUY")}
                  {askPrice && (
                    <span className="text-xs block">@ {askPrice.toFixed(priceDecimals)}</span>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
	
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
