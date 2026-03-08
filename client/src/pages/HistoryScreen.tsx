import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { getQuoteDecimals } from "@shared/pips";
import { toFiniteNumber } from "@shared/scalars";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  normalizeCloseReason,
  closeReasonShortLabel,
  closeReasonVariant,
  listTraderFacingCloseReasons,
  type CloseReasonCode,
  type CloseReasonUiVariant,
} from "@shared/closeReasons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useI18n } from "@/i18n";
import { useMobile } from "@/hooks/use-mobile";

// Sortable column types
type SortColumn =
  | "ticket"
  | "symbol"
  | "openTime"
  | "closeTime"
  | "type"
  | "lots"
  | "openPrice"
  | "closePrice"
  | "profit"
  | "duration"
  | "closeReason";

type SortDirection = "asc" | "desc";

interface SortConfig {
  column: SortColumn | null;
  direction: SortDirection;
}

// Sortable header component
function SortableHeader({
  column,
  label,
  currentSort,
  onSort,
  className,
}: {
  column: SortColumn;
  label: string;
  currentSort: SortConfig;
  onSort: (column: SortColumn) => void;
  className?: string;
}) {
  const isActive = currentSort.column === column;

  return (
    <TableHead
      className={`text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors select-none ${className || ""}`}
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <span className="inline-flex">
          {isActive ? (
            currentSort.direction === "asc" ? (
              <ArrowUp className="h-3 w-3 text-primary" />
            ) : (
              <ArrowDown className="h-3 w-3 text-primary" />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-30" />
          )}
        </span>
      </div>
    </TableHead>
  );
}

// Get variant-based badge styles for close reason
function getCloseReasonBadgeClass(variant: CloseReasonUiVariant): string {
  switch (variant) {
    case "success":
      return "bg-green-900/50 text-green-300 border-green-700/50";
    case "danger":
      return "bg-red-900/50 text-red-300 border-red-700/50";
    case "warning":
      return "bg-yellow-900/50 text-yellow-300 border-yellow-700/50";
    case "info":
      return "bg-primary/10 text-primary border-primary/30";
    case "neutral":
    default:
      return "bg-gray-800/50 text-gray-300 border-gray-700/50";
  }
}

function toMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return num < 1e12 ? num * 1000 : num;
}

function getTradeNetProfitUsd(trade: any): number | null {
  return (
    toFiniteNumber(trade?.netProfitUsd) ??
    toFiniteNumber(trade?.profit) ??
    toFiniteNumber(trade?.pnl) ??
    toFiniteNumber(trade?.realizedPnl)
  );
}

function getDuration(openedAt: unknown, closedAt: unknown): string {
  const openMs = toMs(openedAt);
  const closeMs = toMs(closedAt);
  if (openMs === null || closeMs === null) return "—";
  const diffMs = closeMs - openMs;
  if (diffMs < 0) return "—";
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function HistoryScreen() {
  const { locale } = useI18n();
  const calendarMonthOptions = [
    { value: 0, label: "January" },
    { value: 1, label: "February" },
    { value: 2, label: "March" },
    { value: 3, label: "April" },
    { value: 4, label: "May" },
    { value: 5, label: "June" },
    { value: 6, label: "July" },
    { value: 7, label: "August" },
    { value: 8, label: "September" },
    { value: 9, label: "October" },
    { value: 10, label: "November" },
    { value: 11, label: "December" },
  ];
  const sideLabels: Record<string, { label: string }> = {
    BUY: { label: "Buy" },
    SELL: { label: "Sell" },
  };

  const getSideLabel = (side: unknown) => {
    const key = String(side ?? "").trim().toUpperCase();
    if (!key) return "—";
    return sideLabels[key]?.label ?? key;
  };
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("7days");
  const [lastTimeFilter, setLastTimeFilter] = useState("7days");
  const [closeReasonFilter, setCloseReasonFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(undefined);
  const [isDateRangeOpen, setIsDateRangeOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: "closeTime", direction: "desc" });
  const isMobile = useMobile();

  // Container width detection for responsive table vs compact view
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  // Threshold for switching to compact view (when table would need to scroll)
  const COMPACT_VIEW_THRESHOLD = 900;
  const useCompactView = containerWidth < COMPACT_VIEW_THRESHOLD;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);
    // Set initial width
    setContainerWidth(container.clientWidth);

    return () => observer.disconnect();
  }, []);

  const toggleRowExpand = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const today = new Date();
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  const calendarStartMonth = new Date(2000, 0, 1);
  const calendarEndMonth = today;
  const [startCalendarMonth, setStartCalendarMonth] = useState<Date>(() => {
    const base = new Date(today.getFullYear(), today.getMonth(), 1);
    base.setMonth(base.getMonth() - 1);
    return base;
  });
  const [endCalendarMonth, setEndCalendarMonth] = useState<Date>(() => {
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const formatCalendarMonth = (month: Date) => {
    const label = calendarMonthOptions[month.getMonth()]?.label;
    return label ?? format(month, "MMMM");
  };
  const calendarFormatters = {
    formatMonthDropdown: (month: Date) => formatCalendarMonth(month),
  };

  // Get trader-facing close reasons for filter dropdown
  const traderCloseReasons = listTraderFacingCloseReasons();

  const { data: trades = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/trades/history"],
  });

  const { data: symbols = [] } = useQuery<any[]>({
    queryKey: ["/api/config/symbols"],
  });

  // Filter trades based on selected filters and only show closed trades
  const filteredTrades = trades
    .filter((trade: any) => {
      const isClosed =
        String(trade.status ?? "").toUpperCase() === "CLOSED" ||
        trade.closePrice !== null && trade.closePrice !== undefined ||
        trade.closedAt !== null && trade.closedAt !== undefined;

      // Only include closed trades
      if (!isClosed) {
        return false;
      }

      // Symbol filter
      if (symbolFilter !== "all" && trade.symbol?.symbol !== symbolFilter) {
        return false;
      }

      // Search filter (matches ticket, symbol, or close reason label)
      if (search) {
        const searchLower = search.toLowerCase();
        const symbolMatch = trade.symbol?.symbol?.toLowerCase().includes(searchLower);
        const ticketMatch = String(trade.id).includes(searchLower);
        const closeReasonLabel = closeReasonShortLabel(trade.closeReason, "").toLowerCase();
        const closeReasonMatch = closeReasonLabel.includes(searchLower);

        if (!symbolMatch && !ticketMatch && !closeReasonMatch) {
          return false;
        }
      }

      // Close reason filter
      if (closeReasonFilter !== "all") {
        const normalizedReason = normalizeCloseReason(trade.closeReason);
        if (normalizedReason !== closeReasonFilter) {
          return false;
        }
      }

      // Time filter
      const tradeDateMs = toMs(trade.closedAt ?? trade.openedAt);
      if (!tradeDateMs) return false;
      const tradeDate = new Date(tradeDateMs);
      const now = new Date();

      if (timeFilter === "today") {
        // Check if the trade date is today
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        if (tradeDate < today) return false;
      } else if (timeFilter === "7days") {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        if (tradeDate < sevenDaysAgo) return false;
      } else if (timeFilter === "30days") {
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);
        if (tradeDate < thirtyDaysAgo) return false;
      } else if (timeFilter === "90days") {
        const ninetyDaysAgo = new Date(now);
        ninetyDaysAgo.setDate(now.getDate() - 90);
        if (tradeDate < ninetyDaysAgo) return false;
      } else if (timeFilter === "custom" && customDateRange && customDateRange.from && customDateRange.to) {
        // Set start date to beginning of day and end date to end of day
        const startDate = new Date(customDateRange.from);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(customDateRange.to);
        endDate.setHours(23, 59, 59, 999);

        if (tradeDate < startDate || tradeDate > endDate) return false;
      }

      return true;
    });

  // Sorting function
  const handleSort = (column: SortColumn) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        // Toggle direction if same column
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      // New column, default to descending (newest/highest first)
      return { column, direction: "desc" };
    });
    setCurrentPage(1); // Reset to first page when sorting
  };

  // Sort filtered trades
  const sortedTrades = [...filteredTrades].sort((a: any, b: any) => {
    if (!sortConfig.column) return 0;

    let aValue: any;
    let bValue: any;

    switch (sortConfig.column) {
      case "ticket":
        aValue = a.id;
        bValue = b.id;
        break;
      case "symbol":
        aValue = a.symbol?.symbol || "";
        bValue = b.symbol?.symbol || "";
        break;
      case "openTime":
        aValue = toMs(a.openedAt) || 0;
        bValue = toMs(b.openedAt) || 0;
        break;
      case "closeTime":
        aValue = toMs(a.closedAt) || 0;
        bValue = toMs(b.closedAt) || 0;
        break;
      case "type":
        aValue = a.type || "";
        bValue = b.type || "";
        break;
      case "lots":
        aValue = a.lots || a.size || 0;
        bValue = b.lots || b.size || 0;
        break;
      case "openPrice":
        aValue = a.openPrice || 0;
        bValue = b.openPrice || 0;
        break;
      case "closePrice":
        aValue = a.closePrice || 0;
        bValue = b.closePrice || 0;
        break;
      case "profit":
        aValue = getTradeNetProfitUsd(a) ?? 0;
        bValue = getTradeNetProfitUsd(b) ?? 0;
        break;
      case "duration":
        const aOpen = toMs(a.openedAt);
        const aClose = toMs(a.closedAt);
        const bOpen = toMs(b.openedAt);
        const bClose = toMs(b.closedAt);
        aValue = (aOpen !== null && aClose !== null) ? (aClose - aOpen) : 0;
        bValue = (bOpen !== null && bClose !== null) ? (bClose - bOpen) : 0;
        break;
      case "closeReason":
        aValue = closeReasonShortLabel(a.closeReason, "");
        bValue = closeReasonShortLabel(b.closeReason, "");
        break;
      default:
        return 0;
    }

    // Compare values
    if (typeof aValue === "string" && typeof bValue === "string") {
      const comparison = aValue.localeCompare(bValue);
      return sortConfig.direction === "asc" ? comparison : -comparison;
    }

    if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  // Pagination
  const itemsPerPage = 6;
  const totalPages = Math.ceil(sortedTrades.length / itemsPerPage);
  const paginatedTrades = sortedTrades.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleCustomRangeSelect = (range: DateRange | undefined) => {
    setCustomDateRange(range);
    if (range?.from && range?.to) {
      setCurrentPage(1);
    }
  };

  return (
    <div className="tq-history-screen h-full flex flex-col bg-neutral-900">
      <div className="tq-panel-header tq-page-header">
        <h2 className="tq-page-title">Trade History</h2>
      </div>

      {/* Filters - Compact responsive layout */}
      <div className="tq-history-filters px-gutter py-2 border-b border-gray-800">
        {/* Search - full width on mobile, constrained on desktop */}
        <div className="relative mb-2 md:mb-0 md:max-w-xs md:inline-block md:mr-3">
          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5 text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <Input
            type="text"
            placeholder="Search..."
            className="tq-history-input block w-full pl-7 pr-2 py-1.5 text-sm border border-gray-700 bg-neutral-850 rounded-md text-white placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-primary"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>

        {/* Dropdowns - horizontal scroll on mobile */}
        <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0 md:inline-flex md:gap-3">
          <Select value={symbolFilter} onValueChange={(val) => {
            setSymbolFilter(val);
            setCurrentPage(1);
          }}>
            <SelectTrigger className="tq-history-select min-w-[100px] w-auto h-8 text-xs bg-neutral-850 border-gray-700 text-white">
              <SelectValue placeholder="Symbol" />
            </SelectTrigger>
            <SelectContent className="tq-history-select-content">
              <SelectItem className="tq-history-select-item" value="all">All Symbols</SelectItem>
              {symbols.map((symbol: any) => (
                <SelectItem className="tq-history-select-item" key={symbol.id} value={symbol.symbol}>
                  {symbol.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={timeFilter}
            onValueChange={(val) => {
              setTimeFilter(val);
              setCurrentPage(1);
              if (val === "custom") {
                setIsDateRangeOpen(true);
                return;
              }
              setIsDateRangeOpen(false);
              setLastTimeFilter(val);
              setCustomDateRange(undefined);
            }}
          >
            <SelectTrigger className="tq-history-select min-w-[90px] w-auto h-8 text-xs bg-neutral-850 border-gray-700 text-white">
              <SelectValue placeholder="Time" />
            </SelectTrigger>
            <SelectContent className="tq-history-select-content">
              <SelectItem className="tq-history-select-item" value="today">Today</SelectItem>
              <SelectItem className="tq-history-select-item" value="7days">7 days</SelectItem>
              <SelectItem className="tq-history-select-item" value="30days">30 days</SelectItem>
              <SelectItem className="tq-history-select-item" value="90days">90 days</SelectItem>
              <SelectItem className="tq-history-select-item" value="all">All</SelectItem>
              <SelectItem className="tq-history-select-item" value="custom">Custom...</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={closeReasonFilter}
            onValueChange={(val) => {
              setCloseReasonFilter(val);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="tq-history-select min-w-[90px] w-auto h-8 text-xs bg-neutral-850 border-gray-700 text-white">
              <SelectValue placeholder="Reason" />
            </SelectTrigger>
            <SelectContent className="tq-history-select-content">
              <SelectItem className="tq-history-select-item" value="all">All Reasons</SelectItem>
              {traderCloseReasons.map((reason) => (
                <SelectItem className="tq-history-select-item" key={reason.code} value={reason.code}>
                  {reason.shortLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Calendar for custom date range */}
      {timeFilter === "custom" && isDateRangeOpen && (
        <>
          {isMobile ? (
            <Sheet
              open={isDateRangeOpen}
              onOpenChange={(open) => setIsDateRangeOpen(open)}
            >
              <SheetContent
                side="bottom"
                className="bg-neutral-900 border-gray-800 px-4 py-5 sm:max-w-none max-h-[90vh] overflow-y-auto"
              >
                <SheetHeader className="text-left">
                  <SheetTitle className="text-white">Select date range</SheetTitle>
                </SheetHeader>
                <div className="mt-4 rounded-md border border-gray-800 bg-neutral-850 p-3">
                  <Calendar
                    mode="range"
                    selected={customDateRange}
                    onSelect={handleCustomRangeSelect}
                    className="bg-neutral-850 text-white border-none"
                    formatters={calendarFormatters}
                    captionLayout="dropdown"
                    startMonth={calendarStartMonth}
                    endMonth={calendarEndMonth}
                    reverseYears
                    pagedNavigation={false}
                    navLayout="around"
                    disabled={(date) => date > todayEnd}
                    fixedWeeks
                    numberOfMonths={1}
                    month={endCalendarMonth}
                    onMonthChange={setEndCalendarMonth}
                    initialFocus
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      className="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-sm"
                      onClick={() => {
                        setTimeFilter(lastTimeFilter);
                        setCustomDateRange(undefined);
                        setIsDateRangeOpen(false);
                        setCurrentPage(1);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-3 py-1 bg-primary hover:bg-primary/90 rounded text-black text-sm font-semibold"
                      onClick={() => {
                        if (customDateRange?.from && customDateRange?.to) {
                          setIsDateRangeOpen(false);
                        }
                      }}
                      disabled={!customDateRange?.from || !customDateRange?.to}
                    >
                      Apply
                    </button>
                  </div>
                </div>
                <div className="mt-3 text-sm text-gray-400">
                  {customDateRange && customDateRange.from && customDateRange.to && (
                    <span>
                      Showing trades from {format(customDateRange.from, "MMM d, yyyy")} to{" "}
                      {format(customDateRange.to, "MMM d, yyyy")}
                    </span>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <div className="px-gutter py-3 border-b border-gray-800" id="dateRangeCollapsible">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Select date range:</h3>
              <div className="bg-neutral-850 rounded-md p-3 inline-block md:w-auto w-full">
                <div className="flex flex-col gap-4 md:flex-row md:gap-6">
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                      Start date
                    </div>
                    <Calendar
                      mode="range"
                      selected={customDateRange}
                      onSelect={handleCustomRangeSelect}
                      className="bg-neutral-850 text-white border-none"
                      formatters={calendarFormatters}
                      captionLayout="dropdown"
                      startMonth={calendarStartMonth}
                      endMonth={calendarEndMonth}
                      reverseYears
                      pagedNavigation={false}
                      navLayout="around"
                      disabled={(date) => date > todayEnd}
                      fixedWeeks
                      numberOfMonths={1}
                      month={startCalendarMonth}
                      onMonthChange={setStartCalendarMonth}
                    />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                      End date
                    </div>
                    <Calendar
                      mode="range"
                      selected={customDateRange}
                      onSelect={handleCustomRangeSelect}
                      className="bg-neutral-850 text-white border-none"
                      formatters={calendarFormatters}
                      captionLayout="dropdown"
                      startMonth={calendarStartMonth}
                      endMonth={calendarEndMonth}
                      reverseYears
                      pagedNavigation={false}
                      navLayout="around"
                      disabled={(date) => date > todayEnd}
                      fixedWeeks
                      numberOfMonths={1}
                      month={endCalendarMonth}
                      onMonthChange={setEndCalendarMonth}
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    className="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-sm"
                    onClick={() => {
                      setTimeFilter(lastTimeFilter);
                      setCustomDateRange(undefined);
                      setIsDateRangeOpen(false);
                      setCurrentPage(1);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1 bg-primary hover:bg-primary/90 rounded text-black text-sm font-semibold"
                    onClick={() => {
                      if (customDateRange?.from && customDateRange?.to) {
                        setIsDateRangeOpen(false);
                      }
                    }}
                    disabled={!customDateRange?.from || !customDateRange?.to}
                  >
                    Apply
                  </button>
                </div>
              </div>
              <div className="mt-2 text-sm text-gray-400">
                {customDateRange && customDateRange.from && customDateRange.to && (
                  <span>
                    Showing trades from {format(customDateRange.from, "MMM d, yyyy")} to{" "}
                    {format(customDateRange.to, "MMM d, yyyy")}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Date range display when calendar is collapsed */}
      {timeFilter === "custom" && customDateRange?.from && customDateRange?.to && !isDateRangeOpen && (
        <div id="dateRangeSummary" className="px-gutter py-2 border-b border-gray-800 flex justify-between items-center">
          <div className="text-sm text-white">
            <span className="text-gray-400 mr-2">Custom range:</span>
            {format(customDateRange.from, 'MMM d, yyyy')} - {format(customDateRange.to, 'MMM d, yyyy')}
          </div>
          <button
            className="text-primary hover:text-primary/80 text-sm font-semibold"
            onClick={() => {
              setIsDateRangeOpen(true);
            }}
          >
            Change
          </button>
        </div>
      )}

      {/* Trade history table */}
      <div ref={containerRef} className="tq-history-table-region flex-1 overflow-auto">
        {useCompactView ? (
          /* Compact view: Expandable rows (when container too narrow for full table) */
          <div className="divide-y divide-gray-800">
            {isLoading && Array(4).fill(null).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
            ))}

            {!isLoading && paginatedTrades.length === 0 && (
              <div className="tq-history-empty text-center py-8 text-gray-500">
                No trades found
              </div>
            )}

            {!isLoading && paginatedTrades.map((trade: any) => {
              const isExpanded = expandedRows.has(trade.id);
              const decimals = getQuoteDecimals({
                symbol: trade.symbol?.symbol,
                category: trade.symbol?.category,
                quoteCurrency: trade.symbol?.quoteCurrency,
                pipDecimals: trade.symbol?.pipDecimals,
                quoteDecimals: trade.symbol?.quoteDecimals,
              });
              const rawProfitValue = getTradeNetProfitUsd(trade);
              const profitValue = rawProfitValue ?? 0;
              const hasProfitValue = rawProfitValue !== null;
              const isProfit = profitValue >= 0;

              return (
                <div key={trade.id}>
                  {/* Compact row header */}
                  <div
                    className="tq-history-row px-4 py-3 flex items-center cursor-pointer hover:bg-neutral-850 active:bg-neutral-800"
                    onClick={() => toggleRowExpand(trade.id)}
                  >
                    {/* Symbol - fixed width */}
                    <span className="font-bold text-white text-sm w-[72px] shrink-0">
                      {trade.symbol?.symbol}
                    </span>

                    {/* Size - fixed width */}
                    <span className="text-xs text-gray-400 w-[28px] shrink-0 text-center">
                      {trade.lots || trade.size}
                    </span>

                    {/* Entry → Exit with directional arrow - flex grow */}
                    <div className="flex items-center gap-1 font-mono text-xs flex-1 justify-center">
                      <span className="text-gray-300">{trade.openPrice?.toFixed(decimals)}</span>
                      <span className={`font-bold text-sm ${trade.type === "BUY" ? "text-lime-500" : "text-orange-500"}`}>
                        {trade.type === "BUY" ? "↗" : "↘"}
                      </span>
                      <span className="text-gray-300">{trade.closePrice?.toFixed(decimals) || "—"}</span>
                    </div>

                    {/* P/L - fixed width */}
                    <div className={`font-mono font-semibold text-sm w-[80px] shrink-0 text-right ${isProfit ? "text-green-500" : "text-red-500"}`}>
                      {hasProfitValue ? (
                        <>
                          {isProfit ? "+" : "-"}${Math.abs(profitValue).toFixed(2)}
                        </>
                      ) : "—"}
                    </div>

                    {/* Chevron - fixed width */}
                    <div className="w-[24px] shrink-0 text-gray-400 text-right">
                      {isExpanded ? <ChevronUp className="h-4 w-4 inline" /> : <ChevronDown className="h-4 w-4 inline" />}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 bg-neutral-850 border-t border-gray-700">
                      <div className="grid grid-cols-2 gap-3 pt-3 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">Ticket</span>
                          <div className="text-white font-mono">{trade.id}</div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Type</span>
                          <div>
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${trade.type === "BUY" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"
                              }`}>
                              {getSideLabel(trade.type)}
                            </span>
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Open Time</span>
                          <div className="text-gray-300 text-xs">
                            {(() => {
                              const ms = toMs(trade.openedAt);
                              return ms ? new Date(ms).toLocaleString(locale) : "—";
                            })()}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Close Time</span>
                          <div className="text-gray-300 text-xs">
                            {(() => {
                              const ms = toMs(trade.closedAt);
                              return ms ? new Date(ms).toLocaleString(locale) : "—";
                            })()}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Open Price</span>
                          <div className="text-white font-mono">{trade.openPrice?.toFixed(decimals)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Close Price</span>
                          <div className="text-white font-mono">{trade.closePrice?.toFixed(decimals) || "—"}</div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Duration</span>
                          <div className="text-white">{getDuration(trade.openedAt, trade.closedAt)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Close Reason</span>
                          <div>
                            {(() => {
                              const label = closeReasonShortLabel(trade.closeReason);
                              const variant = closeReasonVariant(trade.closeReason);
                              const badgeClass = getCloseReasonBadgeClass(variant);
                              if (label === "—") return <span className="text-gray-500">—</span>;
                              return <span className={`px-2 py-0.5 text-xs rounded border ${badgeClass}`}>{label}</span>;
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Full table: Only shown when container is wide enough (≥900px) */
          <div className="w-full">
            <Table className="tq-history-table w-full">
              <TableHeader className="bg-neutral-850">
                <TableRow>
                  <SortableHeader column="ticket" label="Ticket" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader column="symbol" label="Symbol" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader column="openTime" label="Open Time" currentSort={sortConfig} onSort={handleSort} className="min-w-[130px]" />
                  <SortableHeader column="closeTime" label="Close Time" currentSort={sortConfig} onSort={handleSort} className="min-w-[130px]" />
                  <SortableHeader column="type" label="Type" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader column="lots" label="Lots" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader column="openPrice" label="Open Price" currentSort={sortConfig} onSort={handleSort} className="min-w-[90px]" />
                  <SortableHeader column="closePrice" label="Close Price" currentSort={sortConfig} onSort={handleSort} className="min-w-[90px]" />
                  <SortableHeader column="profit" label="Profit/Loss" currentSort={sortConfig} onSort={handleSort} className="min-w-[90px]" />
                  <SortableHeader column="duration" label="Duration" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader column="closeReason" label="Close Reason" currentSort={sortConfig} onSort={handleSort} />
                </TableRow>
              </TableHeader>
              <TableBody className="bg-neutral-900 divide-y divide-gray-800">
                {isLoading &&
                  Array(4)
                    .fill(null)
                    .map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      </TableRow>
                    ))}

                {!isLoading && paginatedTrades.length === 0 && (
                  <TableRow className="tq-history-empty-row">
                    <TableCell colSpan={11} className="tq-history-empty-cell text-center py-8 text-gray-500">
                      No trades found
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading &&
                  paginatedTrades.map((trade: any) => (
                    <TableRow key={trade.id} className="hover:bg-neutral-850">
                      <TableCell>
                        <div className="font-medium text-white">{trade.id}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-white">{trade.symbol?.symbol}</div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-400">
                        {(() => {
                          const openedAtMs = toMs(trade.openedAt);
                          return openedAtMs ? new Date(openedAtMs).toLocaleString(locale) : "—";
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-gray-400">
                        {(() => {
                          const closedAtMs = toMs(trade.closedAt);
                          return closedAtMs ? new Date(closedAtMs).toLocaleString(locale) : "—";
                        })()}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${trade.type === "BUY"
                            ? "bg-green-900 text-green-300"
                            : "bg-red-900 text-red-300"
                            }`}
                        >
                          {getSideLabel(trade.type)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono">
                        {trade.lots ? trade.lots.toLocaleString() : trade.size.toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono">
                        {(() => {
                          const decimals = getQuoteDecimals({
                            symbol: trade.symbol?.symbol,
                            category: trade.symbol?.category,
                            quoteCurrency: trade.symbol?.quoteCurrency,
                            pipDecimals: trade.symbol?.pipDecimals,
                            quoteDecimals: trade.symbol?.quoteDecimals,
                          });
                          return trade.openPrice.toFixed(decimals);
                        })()}
                      </TableCell>
                      <TableCell className="font-mono">
                        {trade.closePrice
                          ? (() => {
                            const decimals = getQuoteDecimals({
                              symbol: trade.symbol?.symbol,
                              category: trade.symbol?.category,
                              quoteCurrency: trade.symbol?.quoteCurrency,
                              pipDecimals: trade.symbol?.pipDecimals,
                              quoteDecimals: trade.symbol?.quoteDecimals,
                            });
                            return trade.closePrice.toFixed(decimals);
                          })()
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const rawProfit = getTradeNetProfitUsd(trade);
                          if (rawProfit === null) return <div className="text-gray-400">—</div>;
                          return (
                            <div
                              className={`font-mono font-medium ${rawProfit >= 0
                                ? "text-green-500"
                                : "text-red-500"
                                }`}
                            >
                              {rawProfit >= 0 ? "+" : "-"}
                              {Math.abs(rawProfit).toFixed(2)}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-gray-300">
                        {getDuration(trade.openedAt, trade.closedAt)}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const label = closeReasonShortLabel(trade.closeReason);
                          const variant = closeReasonVariant(trade.closeReason);
                          const badgeClass = getCloseReasonBadgeClass(variant);

                          if (label === "—") {
                            return <span className="text-gray-500">—</span>;
                          }

                          return (
                            <span className={`px-2 py-1 text-xs rounded border ${badgeClass}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {sortedTrades.length > 0 && (
        <div className="tq-history-pagination px-gutter py-3 flex items-center justify-between border-t border-gray-800">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              className="relative inline-flex items-center px-4 py-2 border border-gray-700 text-sm font-medium rounded-md text-gray-300 bg-neutral-850 hover:bg-neutral-800"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <button
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-700 text-sm font-medium rounded-md text-gray-300 bg-neutral-850 hover:bg-neutral-800"
              onClick={() =>
                setCurrentPage(Math.min(totalPages, currentPage + 1))
              }
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-400">
                Showing{" "}
                <span className="font-medium">
                  {(currentPage - 1) * itemsPerPage + 1}
                </span>{" "}
                to{" "}
                <span className="font-medium">
                  {Math.min(currentPage * itemsPerPage, sortedTrades.length)}
                </span>{" "}
                of <span className="font-medium">{sortedTrades.length}</span>{" "}
                results
              </p>
            </div>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentPage(Math.max(1, currentPage - 1));
                    }}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                  const pageNumber = i + 1;
                  return (
                    <PaginationItem key={i}>
                      <PaginationLink
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setCurrentPage(pageNumber);
                        }}
                        isActive={pageNumber === currentPage}
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentPage(Math.min(totalPages, currentPage + 1));
                    }}
                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      )}
    </div>
  );
}
