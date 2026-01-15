import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
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
      return "bg-blue-900/50 text-blue-300 border-blue-700/50";
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

export default function HistoryScreen() {
  const { locale } = useI18n();
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
  const [closeReasonFilter, setCloseReasonFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(undefined);
  
  // Get trader-facing close reasons for filter dropdown
  const traderCloseReasons = listTraderFacingCloseReasons();

  const { data: trades = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/trades"],
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

  // Pagination
  const itemsPerPage = 6;
  const totalPages = Math.ceil(filteredTrades.length / itemsPerPage);
  const paginatedTrades = filteredTrades.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="h-full flex flex-col bg-neutral-900">
      <div className="px-gutter py-3 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-white">Trade History</h2>
      </div>

      {/* Filters */}
      <div className="px-gutter py-3 border-b border-gray-800 flex flex-wrap items-center gap-3">
        <div className="relative flex-grow max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-gray-500"
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
            placeholder="Search trades..."
            className="block w-full pl-10 pr-3 py-2 border border-gray-700 bg-neutral-850 rounded-md text-white placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-primary"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1); // Reset pagination when search changes
            }}
          />
        </div>

        <Select value={symbolFilter} onValueChange={(val) => {
            setSymbolFilter(val);
            setCurrentPage(1); // Reset pagination when filter changes
          }}>
          <SelectTrigger className="w-[160px] bg-neutral-850 border-gray-700 text-white">
            <SelectValue placeholder="All Symbols" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Symbols</SelectItem>
            {symbols.map((symbol: any) => (
              <SelectItem key={symbol.id} value={symbol.symbol}>
                {symbol.symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select 
          value={timeFilter} 
          onValueChange={(val) => {
            setTimeFilter(val);
            setCurrentPage(1); // Reset pagination when time filter changes
            if (val !== 'custom') {
              setCustomDateRange(undefined);
            }
          }}
        >
          <SelectTrigger className="w-[160px] bg-neutral-850 border-gray-700 text-white">
            <SelectValue placeholder="Last 7 days" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7days">Last 7 days</SelectItem>
            <SelectItem value="30days">Last 30 days</SelectItem>
            <SelectItem value="90days">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="custom">Custom range...</SelectItem>
          </SelectContent>
        </Select>
        
        <Select 
          value={closeReasonFilter} 
          onValueChange={(val) => {
            setCloseReasonFilter(val);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[160px] bg-neutral-850 border-gray-700 text-white">
            <SelectValue placeholder="All Reasons" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reasons</SelectItem>
            {traderCloseReasons.map((reason) => (
              <SelectItem key={reason.code} value={reason.code}>
                {reason.shortLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Calendar for custom date range */}
      {timeFilter === 'custom' && (
        <div className="px-gutter py-3 border-b border-gray-800" id="dateRangeCollapsible">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Select date range:</h3>
          <div className="bg-neutral-850 rounded-md p-3 inline-block md:w-auto w-full">
            <Calendar
              mode="range"
              selected={customDateRange}
              onSelect={setCustomDateRange}
              className="bg-neutral-850 text-white border-none"
              disabled={(date) => date > new Date()}
              initialFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <button 
                className="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-sm"
                onClick={() => {
                  setTimeFilter("30days");
                  setCustomDateRange(undefined);
                }}
              >
                Cancel
              </button>
              <button 
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-sm"
                onClick={() => {
                  // If valid date range is selected, hide the calendar component
                  if (customDateRange?.from && customDateRange?.to) {
                    const dateSelector = document.getElementById('dateRangeCollapsible');
                    if (dateSelector) {
                      dateSelector.style.display = 'none';
                    }
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
                Showing trades from {format(customDateRange.from, 'MMM d, yyyy')} to {format(customDateRange.to, 'MMM d, yyyy')}
              </span>
            )}
          </div>
        </div>
      )}
      
      {/* Date range display when calendar is collapsed */}
      {timeFilter === 'custom' && customDateRange?.from && customDateRange?.to && (
        <div id="dateRangeSummary" className="px-gutter py-2 border-b border-gray-800 flex justify-between items-center">
          <div className="text-sm text-white">
            <span className="text-gray-400 mr-2">Custom range:</span>
            {format(customDateRange.from, 'MMM d, yyyy')} - {format(customDateRange.to, 'MMM d, yyyy')}
          </div>
          <button 
            className="text-blue-400 hover:text-blue-300 text-sm"
            onClick={() => {
              const dateSelector = document.getElementById('dateRangeCollapsible');
              if (dateSelector) {
                dateSelector.style.display = 'block';
              }
            }}
          >
            Change
          </button>
        </div>
      )}
      
      {/* Trade history table */}
      <div className="flex-1 overflow-auto">
        <div className="w-full overflow-x-auto">
          <Table className="min-w-[800px]">
          <TableHeader className="bg-neutral-850">
            <TableRow>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Ticket
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Symbol
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Open Time
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Close Time
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Type
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Lots
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Open Price
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Close Price
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Profit/Loss
              </TableHead>
              <TableHead className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Close Reason
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-neutral-900 divide-y divide-gray-800">
            {isLoading &&
              Array(4)
                .fill(null)
                .map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  </TableRow>
                ))}

            {!isLoading && paginatedTrades.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-gray-500">
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
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        trade.type === "BUY"
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
                      const isJpy = trade.symbol?.symbol?.includes("JPY");
                      return trade.openPrice.toFixed(isJpy ? 2 : 5);
                    })()}
                  </TableCell>
                  <TableCell className="font-mono">
                    {trade.closePrice
                      ? (() => {
                          const isJpy = trade.symbol?.symbol?.includes("JPY");
                          return trade.closePrice.toFixed(isJpy ? 2 : 5);
                        })()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {trade.profit ? (
                      <div
                        className={`font-mono font-medium ${
                          parseFloat(trade.profit) >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {parseFloat(trade.profit) >= 0 ? "+" : ""}
                        {Math.abs(parseFloat(trade.profit)).toFixed(2)}
                      </div>
                    ) : (
                      <div className="text-gray-400">—</div>
                    )}
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
      </div>

      {/* Pagination */}
      {filteredTrades.length > 0 && (
        <div className="px-gutter py-3 flex items-center justify-between border-t border-gray-800">
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
                  {Math.min(currentPage * itemsPerPage, filteredTrades.length)}
                </span>{" "}
                of <span className="font-medium">{filteredTrades.length}</span>{" "}
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
