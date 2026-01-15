import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Download, Filter, RefreshCw, Search, FileText, ChevronDown, ChevronUp, Shield, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";

interface AuditRecord {
  id: number;
  tradeId: number;
  eventType: string;
  eventCategory: string | null;
  eventAt: string;
  eventAtMs: number | null;
  correlationId: string | null;
  orderId: string | null;
  executionId: string | null;
  positionId: string | null;
  actorType: string | null;
  actorUserId: number | null;
  sessionId: string | null;
  ip: string | null;
  userAgent: string | null;
  symbol: string | null;
  side: string | null;
  orderType: string | null;
  timeInForce: string | null;
  qtyLots: number | null;
  requestedPrice: number | null;
  triggerPrice: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  fillPrice: number | null;
  avgFillPrice: number | null;
  slippage: number | null;
  slippagePips: number | null;
  slippageReference: string | null;
  latencyMs: number | null;
  quoteTs: string | null;
  quoteSource: string | null;
  quoteBid: number | null;
  quoteAsk: number | null;
  quoteMid: number | null;
  quoteSpread: number | null;
  spreadPips: number | null;
  riskCheckName: string | null;
  riskLimitValue: number | null;
  riskObservedValue: number | null;
  riskResult: string | null;
  reasonCode: string | null;
  payloadJson: string | null;
  prevHash: string | null;
  eventHash: string | null;
  note: string | null;
  userId: number | null;
  username: string | null;
}

export default function AdminTradeAudit() {
  const sideLabels: Record<string, { label: string }> = {
    BUY: { label: "Buy" },
    SELL: { label: "Sell" },
  };

  const getSideLabel = (side: unknown) => {
    const key = String(side ?? "").trim().toUpperCase();
    if (!key) return "-";
    return sideLabels[key]?.label ?? key;
  };

  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [riskResultFilter, setRiskResultFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [limit, setLimit] = useState("500");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [hideAccountEvents, setHideAccountEvents] = useState(() => {
    try {
      const raw = localStorage.getItem("adminTradeAudit.hideAccountEvents");
      if (raw === null) return true;
      return raw === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("adminTradeAudit.hideAccountEvents", String(hideAccountEvents));
    } catch {
      // ignore storage errors (private browsing, quota)
    }
  }, [hideAccountEvents]);

  const fetchAuditRecords = async () => {
    setLoading(true);
    try {
      const response = await fetchWithIdentity(`/api/admin/trade-audit?limit=${limit}`);
      if (response.ok) {
        const data = await response.json();
        setAuditRecords(data);
        setFilteredRecords(data);
      }
    } catch (error) {
      console.error("Error fetching audit records:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditRecords();
  }, [limit]);

  const isAccountEvent = (r: AuditRecord) =>
    r.eventCategory === "ACCOUNT" || r.eventType.startsWith("ACCOUNT_");

  const accountEventsTotal = auditRecords.filter(isAccountEvent).length;

  useEffect(() => {
    let filtered = auditRecords;
    
    if (eventTypeFilter !== "all") {
      if (eventTypeFilter === "ACCOUNT_EVENTS") {
        filtered = filtered.filter(isAccountEvent);
      } else {
        filtered = filtered.filter(r => r.eventType === eventTypeFilter);
      }
    }
    
    if (riskResultFilter !== "all") {
      if (riskResultFilter === "REJECTED") {
        filtered = filtered.filter(r => r.eventType === "ORDER_REJECTED" || r.riskResult === "FAIL");
      } else if (riskResultFilter === "PASSED") {
        filtered = filtered.filter(r => r.riskResult === "PASS" || (r.eventType !== "ORDER_REJECTED" && r.eventType.includes("FILLED")));
      }
    }
    
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r => 
        r.symbol?.toLowerCase().includes(term) ||
        r.username?.toLowerCase().includes(term) ||
        String(r.tradeId).includes(term) ||
        r.correlationId?.toLowerCase().includes(term) ||
        r.note?.toLowerCase().includes(term) ||
        r.reasonCode?.toLowerCase().includes(term)
      );
    }

    if (hideAccountEvents && eventTypeFilter !== "ACCOUNT_EVENTS") {
      filtered = filtered.filter(r => !isAccountEvent(r));
    }
    
    setFilteredRecords(filtered);
  }, [eventTypeFilter, riskResultFilter, searchTerm, auditRecords, hideAccountEvents]);

  const toggleRowExpand = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getEventBadgeColor = (eventType: string) => {
    if (eventType?.startsWith("ACCOUNT_")) return "bg-indigo-600";
    switch (eventType) {
      case "ORDER_FILLED":
        return "bg-green-600";
      case "ORDER_REJECTED":
      case "RISK_CHECK_FAIL":
        return "bg-red-600";
      case "ORDER_CANCELED":
        return "bg-yellow-600";
      case "POSITION_CLOSED":
        return "bg-blue-600";
      case "SL_TRIGGERED":
        return "bg-orange-600";
      case "TP_TRIGGERED":
        return "bg-emerald-600";
      case "TARGETS_UPDATED":
        return "bg-purple-600";
      case "RISK_CHECK_PASS":
        return "bg-teal-600";
      default:
        return "bg-gray-600";
    }
  };

  const getResultBadge = (record: AuditRecord) => {
    if (record.eventType === "ORDER_REJECTED" || record.riskResult === "FAIL") {
      return <Badge className="bg-red-600 text-white text-xs"><XCircle className="w-3 h-3 mr-1" />REJECT</Badge>;
    }
    if (record.riskResult === "PASS" || record.eventType.includes("FILLED") || record.eventType.includes("CLOSED")) {
      return <Badge className="bg-green-600/30 text-green-200 text-xs"><CheckCircle className="w-3 h-3 mr-1" />OK</Badge>;
    }
    return <Badge className="bg-gray-600 text-xs">-</Badge>;
  };

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return "-";
    return Number(price).toFixed(5);
  };

  const formatDate = (dateStr: string | null, ms?: number | null) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    const timeStr = date.toLocaleString();
    if (ms) {
      return `${timeStr}.${String(ms % 1000).padStart(3, "0")}`;
    }
    return timeStr;
  };

  const formatSide = (side: string | null) => {
    if (!side) return "-";
    return (
      <span className={side === "BUY" ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
        {getSideLabel(side)}
      </span>
    );
  };

  // Export to CSV with all institutional fields
  const exportToCsv = () => {
    const headers = [
      "ID", "Trade ID", "Event Type", "Event Category", "Event Time", "Event Time (ms)",
      "Correlation ID", "Order ID", "Execution ID", "Position ID",
      "Actor Type", "Actor User ID", "Session ID", "IP", "User Agent",
      "Symbol", "Side", "Order Type", "Time In Force", "Qty (Lots)",
      "Requested Price", "Trigger Price", "Limit Price", "Stop Price", "Fill Price", "Avg Fill Price",
      "Slippage", "Slippage (Pips)", "Slippage Reference", "Latency (ms)",
      "Quote Bid", "Quote Ask", "Quote Mid", "Quote Spread", "Spread (Pips)",
      "Risk Check", "Risk Limit", "Risk Observed", "Risk Result", "Reason Code",
      "User", "Note", "Prev Hash", "Event Hash"
    ];
    
    const rows = filteredRecords.map(r => [
      r.id, r.tradeId, r.eventType, r.eventCategory ?? "", r.eventAt, r.eventAtMs ?? "",
      r.correlationId ?? "", r.orderId ?? "", r.executionId ?? "", r.positionId ?? "",
      r.actorType ?? "", r.actorUserId ?? "", r.sessionId ?? "", r.ip ?? "", r.userAgent ?? "",
      r.symbol ?? "", r.side ?? "", r.orderType ?? "", r.timeInForce ?? "", r.qtyLots ?? "",
      r.requestedPrice ?? "", r.triggerPrice ?? "", r.limitPrice ?? "", r.stopPrice ?? "", r.fillPrice ?? "", r.avgFillPrice ?? "",
      r.slippage ?? "", r.slippagePips ?? "", r.slippageReference ?? "", r.latencyMs ?? "",
      r.quoteBid ?? "", r.quoteAsk ?? "", r.quoteMid ?? "", r.quoteSpread ?? "", r.spreadPips ?? "",
      r.riskCheckName ?? "", r.riskLimitValue ?? "", r.riskObservedValue ?? "", r.riskResult ?? "", r.reasonCode ?? "",
      r.username ?? "", r.note ?? "", r.prevHash ?? "", r.eventHash ?? ""
    ]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trade-audit-institutional-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export to JSONL for forensic replay
  const exportToJsonl = () => {
    const lines = filteredRecords.map(r => JSON.stringify(r));
    const content = lines.join("\n");
    
    const blob = new Blob([content], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trade-audit-raw-${new Date().toISOString().split("T")[0]}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const eventTypes = [
    "all", "ACCOUNT_EVENTS", "ORDER_FILLED", "ORDER_REJECTED", "ORDER_CANCELED", "POSITION_CLOSED",
    "SL_TRIGGERED", "TP_TRIGGERED", "TARGETS_UPDATED", "RISK_CHECK_PASS", "RISK_CHECK_FAIL"
  ];

  const riskResults = ["all", "PASSED", "REJECTED"];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            Trade Audit Log
            <Badge className="bg-blue-600 text-xs">Institutional Grade</Badge>
          </h2>
          <p className="text-xs text-gray-400 mt-1">OATS-compliant audit trail with tamper-evident hash chain</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchAuditRecords}
            className="bg-neutral-700 hover:bg-neutral-600"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
          <Button 
            variant="csv" 
            size="sm" 
            onClick={exportToCsv}
          >
            <Download className="w-4 h-4 mr-1" />
            Export CSV
          </Button>
          <Button 
            variant="jsonl" 
            size="sm" 
            onClick={exportToJsonl}
          >
            <FileText className="w-4 h-4 mr-1" />
            Export JSONL
          </Button>
        </div>
      </div>
      
      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Event Type:</span>
              <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                <SelectTrigger className="w-[180px] bg-neutral-800 border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-gray-600">
                  {eventTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {type === "all" ? "All Events" : type === "ACCOUNT_EVENTS" ? "Account Events" : type.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Result:</span>
              <Select value={riskResultFilter} onValueChange={setRiskResultFilter}>
                <SelectTrigger className="w-[120px] bg-neutral-800 border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-gray-600">
                  {riskResults.map(result => (
                    <SelectItem key={result} value={result}>
                      {result === "all" ? "All Results" : result}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Limit:</span>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger className="w-[100px] bg-neutral-800 border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-gray-600">
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                  <SelectItem value="1000">1000</SelectItem>
                  <SelectItem value="5000">5000</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Hide ACCOUNT events:</span>
              <div className="flex items-center gap-2">
                <Switch
                  checked={hideAccountEvents}
                  onCheckedChange={setHideAccountEvents}
                />
                <span className="text-xs text-gray-500">
                  {accountEventsTotal > 0 ? `${accountEventsTotal} ACCOUNT` : "0 ACCOUNT"}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by symbol, user, trade ID, correlation ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-neutral-800 border-gray-600"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      
      <div className="text-sm text-gray-400 flex justify-between items-center">
        <span>
          Showing {filteredRecords.length} of {auditRecords.length} records
          {hideAccountEvents && accountEventsTotal > 0 ? (
            <span className="text-xs text-gray-500"> (ACCOUNT hidden)</span>
          ) : null}
        </span>
        <span className="text-xs">Hash-chained for tamper-evidence</span>
      </div>
      
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : filteredRecords.length === 0 ? (
        <Card className="bg-neutral-700 border-gray-600">
          <CardContent className="py-8 text-center">
            <FileText className="w-12 h-12 mx-auto text-gray-500 mb-3" />
            <p className="text-gray-400">No audit records found</p>
            <p className="text-sm text-gray-500 mt-1">Audit records are created when orders are filled, rejected, or positions are closed</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-700 bg-neutral-800">
                <TableHead className="text-gray-400 w-8"></TableHead>
                <TableHead className="text-gray-400">Time (UTC)</TableHead>
                <TableHead className="text-gray-400">Event</TableHead>
                <TableHead className="text-gray-400">Trade ID</TableHead>
                <TableHead className="text-gray-400">Symbol</TableHead>
                <TableHead className="text-gray-400">Side</TableHead>
                <TableHead className="text-gray-400">Qty</TableHead>
                <TableHead className="text-gray-400">Order Type</TableHead>
                <TableHead className="text-gray-400">Req Price</TableHead>
                <TableHead className="text-gray-400">Fill Price</TableHead>
                <TableHead className="text-gray-400">Slip (Pips)</TableHead>
                <TableHead className="text-gray-400">Latency</TableHead>
                <TableHead className="text-gray-400">Result</TableHead>
                <TableHead className="text-gray-400">User</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => (
                <>
                  <TableRow 
                    key={record.id} 
                    className={`border-b border-gray-700 hover:bg-neutral-700 cursor-pointer ${
                      record.eventType === "ORDER_REJECTED" || record.riskResult === "FAIL" ? "bg-red-900/20" : ""
                    }`}
                    onClick={() => toggleRowExpand(record.id)}
                  >
                    <TableCell className="py-2">
                      {expandedRows.has(record.id) ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-mono">{formatDate(record.eventAt, record.eventAtMs)}</TableCell>
                    <TableCell>
                      <Badge className={`${getEventBadgeColor(record.eventType)} text-white text-xs`}>
                        {record.eventType.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{record.tradeId}</TableCell>
                    <TableCell className="font-medium">{record.symbol || "-"}</TableCell>
                    <TableCell>{formatSide(record.side)}</TableCell>
                    <TableCell className="font-mono text-sm">{record.qtyLots ?? "-"}</TableCell>
                    <TableCell className="text-sm">{record.orderType || "-"}</TableCell>
                    <TableCell className="font-mono text-sm">{formatPrice(record.requestedPrice)}</TableCell>
                    <TableCell className="font-mono text-sm">{formatPrice(record.fillPrice)}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {record.slippagePips !== null ? (
                        <span className={Number(record.slippagePips) > 5 ? "text-yellow-400" : ""}>
                          {Number(record.slippagePips).toFixed(1)}
                        </span>
                      ) : record.slippage !== null ? (
                        <span className={Number(record.slippage) > 0 ? "text-red-400" : "text-green-400"}>
                          {Number(record.slippage).toFixed(5)}
                        </span>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {record.latencyMs !== null ? `${record.latencyMs}ms` : "-"}
                    </TableCell>
                    <TableCell>{getResultBadge(record)}</TableCell>
                    <TableCell className="text-sm">{record.username || "-"}</TableCell>
                  </TableRow>
                  
                  {expandedRows.has(record.id) && (
                    <TableRow className="bg-neutral-900 border-b border-gray-700">
                      <TableCell colSpan={14} className="p-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div className="space-y-2">
                            <h4 className="font-semibold text-blue-400 flex items-center gap-1">
                              <Shield className="w-4 h-4" /> Lifecycle IDs
                            </h4>
                            <div className="space-y-1 text-gray-300">
                              <p><span className="text-gray-500">Correlation:</span> <span className="font-mono text-xs">{record.correlationId || "N/A"}</span></p>
                              <p><span className="text-gray-500">Order ID:</span> <span className="font-mono text-xs">{record.orderId || "N/A"}</span></p>
                              <p><span className="text-gray-500">Execution ID:</span> <span className="font-mono text-xs">{record.executionId || "N/A"}</span></p>
                              <p><span className="text-gray-500">Position ID:</span> <span className="font-mono text-xs">{record.positionId || "N/A"}</span></p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-purple-400 flex items-center gap-1">
                              <AlertTriangle className="w-4 h-4" /> Risk Evidence
                            </h4>
                            <div className="space-y-1 text-gray-300">
                              <p><span className="text-gray-500">Risk Check:</span> {record.riskCheckName || "N/A"}</p>
                              <p><span className="text-gray-500">Limit Value:</span> {record.riskLimitValue ?? "N/A"}</p>
                              <p><span className="text-gray-500">Observed Value:</span> {record.riskObservedValue ?? "N/A"}</p>
                              <p><span className="text-gray-500">Result:</span> <span className={record.riskResult === "FAIL" ? "text-red-400" : "text-green-400"}>{record.riskResult || "N/A"}</span></p>
                              <p><span className="text-gray-500">Reason Code:</span> {record.reasonCode || record.note || "N/A"}</p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-green-400">Provenance</h4>
                            <div className="space-y-1 text-gray-300">
                              <p><span className="text-gray-500">Actor:</span> {record.actorType || "SYSTEM"} {record.actorUserId ? `(User ${record.actorUserId})` : ""}</p>
                              <p><span className="text-gray-500">Session:</span> <span className="font-mono text-xs">{record.sessionId?.substring(0, 16) || "N/A"}...</span></p>
                              <p><span className="text-gray-500">IP:</span> {record.ip || "N/A"}</p>
                              <p><span className="text-gray-500">Category:</span> {record.eventCategory || "TRADE"}</p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-yellow-400">Market Context</h4>
                            <div className="space-y-1 text-gray-300">
                              <p><span className="text-gray-500">Quote Bid:</span> {formatPrice(record.quoteBid)}</p>
                              <p><span className="text-gray-500">Quote Ask:</span> {formatPrice(record.quoteAsk)}</p>
                              <p><span className="text-gray-500">Quote Mid:</span> {formatPrice(record.quoteMid)}</p>
                              <p><span className="text-gray-500">Spread:</span> {formatPrice(record.quoteSpread)} ({record.spreadPips?.toFixed(1) ?? "-"} pips)</p>
                              <p><span className="text-gray-500">Slippage Ref:</span> {record.slippageReference || "N/A"}</p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-orange-400">Pricing Details</h4>
                            <div className="space-y-1 text-gray-300">
                              <p><span className="text-gray-500">Limit Price:</span> {formatPrice(record.limitPrice)}</p>
                              <p><span className="text-gray-500">Stop Price:</span> {formatPrice(record.stopPrice)}</p>
                              <p><span className="text-gray-500">Trigger Price:</span> {formatPrice(record.triggerPrice)}</p>
                              <p><span className="text-gray-500">Avg Fill:</span> {formatPrice(record.avgFillPrice)}</p>
                              <p><span className="text-gray-500">Time In Force:</span> {record.timeInForce || "GTC"}</p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-cyan-400">Data Integrity</h4>
                            <div className="space-y-1 text-gray-300">
                              <p><span className="text-gray-500">Prev Hash:</span> <span className="font-mono text-xs">{record.prevHash?.substring(0, 16) || "GENESIS"}...</span></p>
                              <p><span className="text-gray-500">Event Hash:</span> <span className="font-mono text-xs">{record.eventHash?.substring(0, 16) || "N/A"}...</span></p>
                              <p className="text-xs text-gray-500 mt-2">Hash chain ensures tamper-evidence</p>
                            </div>
                          </div>
                        </div>
                        
                        {record.note && (
                          <div className="mt-4 p-2 bg-neutral-800 rounded">
                            <span className="text-gray-500">Note:</span> <span className="text-gray-300">{record.note}</span>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
