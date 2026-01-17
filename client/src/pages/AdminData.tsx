import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Download, FileSpreadsheet, Filter, Users, TrendingUp, DollarSign, BarChart3, Activity } from "lucide-react";
import MiniDonut from "@/components/MiniDonut";
import parseDate from "@/utils/parseDate";
import { LeaderboardTable, LeaderboardEntry, formatCurrency } from "@/components/LeaderboardTable";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";

interface KPIData {
  totalUsers: number;
  activeTraders: number;
  totalTrades: number;
  totalVolume: number;
  totalPnL: number;
  avgWinRate: number;
}

interface DeactivatedSummary {
  totals: {
    total: number;
    deactivated: number;
    deleted: number;
  };
  averages: {
    profitUsd: number;
    trades: number;
    winRatePct: number;
  };
  reasons: Array<{
    reasonCode: string | null;
    reasonText: string | null;
    count: number;
  }>;
  top: Array<{
    userId: number;
    username: string | null;
    email: string | null;
    mode: "DEACTIVATED" | "DELETED";
    reasonCode: string | null;
    reasonText: string | null;
    profitUsd: number;
    trades: number;
    winRatePct: number;
    actionAt: number | null;
  }>;
}

function formatCompactNumber(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (absValue >= 1_000_000) {
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (absValue >= 1_000) {
    return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return value.toLocaleString();
}

function formatSignedCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${formatCurrency(value)}`;
}

export default function AdminData() {
  const [dateRange, setDateRange] = useState("30"); // days
  const [dataTab, setDataTab] = useState<"stats" | "funnel" | "analytics" | "compliance" | "deactivated">("stats");
  const [traderStats, setTraderStats] = useState<any[]>([]);
  const [filteredStats, setFilteredStats] = useState<any[]>([]);
  const [filterValue, setFilterValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [deactivatedSummary, setDeactivatedSummary] = useState<DeactivatedSummary | null>(null);
  const [deactivatedLoading, setDeactivatedLoading] = useState(false);
  const [aggStats, setAggStats] = useState({
    profitPercent: 0,
    winRate: 0,
    avgHoldTime: 0
  });
  const [funnelData, setFunnelData] = useState({
    totalSignups: 0,
    completedProfiles: 0,
    firstTrade: 0,
    tenTrades: 0,
    profitable: 0
  });
  const [analyticsData, setAnalyticsData] = useState({
    activeDaily: 0,
    activeWeekly: 0,
    activeMonthly: 0,
    avgSessionMinutes: 0,
    avgTradesPerUser: 0,
    retentionD7: 0,
    retentionD30: 0
  });
  const [complianceData, setComplianceData] = useState({
    verifiedWithin14Days: 0,
    overdueReverify: 0,
    lockedAccounts: 0,
    pendingKyc: 0,
    totalUsers: 0
  });
  
  // KPI Summary query
  const { data: kpiData } = useQuery<KPIData>({
    queryKey: ["/api/admin/kpi-summary", dateRange],
    queryFn: () => axios.get(`/api/admin/kpi-summary?days=${dateRange}`).then(r => r.data),
  });

  // Fetch trader statistics
  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const response = await fetchWithIdentity(`/api/admin/trader-stats?days=${dateRange}`);
        if (response.ok) {
          const data = await response.json();
          setTraderStats(data);
          setFilteredStats(data);
          
          // Calculate aggregate stats
          if (data.length > 0) {
            const totalProfit = data.reduce((sum: number, trader: any) => sum + parseFloat(trader.profit_percent || 0), 0);
            const totalWins = data.reduce((sum: number, trader: any) => sum + parseFloat(trader.win_rate || 0), 0);
            const totalHoldTime = data.reduce((sum: number, trader: any) => sum + parseFloat(trader.avg_hold_time || 0), 0);
            
            setAggStats({
              profitPercent: totalProfit / data.length / 100, // Convert to 0-1 range
              winRate: totalWins / data.length / 100, // Convert to 0-1 range
              avgHoldTime: totalHoldTime / data.length // Hours
            });
          }
        }
      } catch (error) {
        console.error("Error fetching trader stats:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStats();
  }, [dateRange]);

  // Filter traders based on search input
  useEffect(() => {
    if (!filterValue.trim()) {
      setFilteredStats(traderStats);
      return;
    }
    
    const lowercaseFilter = filterValue.toLowerCase();
    const filtered = traderStats.filter(trader => 
      trader.username?.toLowerCase().includes(lowercaseFilter) || 
      trader.email?.toLowerCase().includes(lowercaseFilter)
    );
    
    setFilteredStats(filtered);
  }, [filterValue, traderStats]);

  // Fetch funnel data
  useEffect(() => {
    const fetchFunnelData = async () => {
      if (dataTab !== "funnel") return;
      try {
        const response = await fetchWithIdentity(`/api/admin/signup-funnel?days=${dateRange}`);
        if (response.ok) {
          const data = await response.json();
          setFunnelData(data);
        }
      } catch (error) {
        console.error("Error fetching funnel data:", error);
      }
    };
    fetchFunnelData();
  }, [dataTab, dateRange]);

  // Fetch analytics data
  useEffect(() => {
    const fetchAnalyticsData = async () => {
      if (dataTab !== "analytics") return;
      try {
        const response = await fetchWithIdentity(`/api/admin/user-analytics?days=${dateRange}`);
        if (response.ok) {
          const data = await response.json();
          setAnalyticsData(data);
        }
      } catch (error) {
        console.error("Error fetching analytics data:", error);
      }
    };
    fetchAnalyticsData();
  }, [dataTab, dateRange]);

  // Fetch compliance data
  useEffect(() => {
    const fetchComplianceData = async () => {
      if (dataTab !== "compliance") return;
      try {
        const response = await fetchWithIdentity("/api/admin/analytics/compliance");
        if (response.ok) {
          const data = await response.json();
          setComplianceData(data);
        }
      } catch (error) {
        console.error("Error fetching compliance data:", error);
      }
    };
    fetchComplianceData();
  }, [dataTab]);

  useEffect(() => {
    const fetchDeactivatedSummary = async () => {
      if (dataTab !== "deactivated") return;
      setDeactivatedLoading(true);
      try {
        const response = await fetchWithIdentity(`/api/admin/deactivated-accounts/summary?days=${dateRange}`);
        if (response.ok) {
          const data = await response.json();
          setDeactivatedSummary(data);
        }
      } catch (error) {
        console.error("Error fetching deactivated account summary:", error);
      } finally {
        setDeactivatedLoading(false);
      }
    };
    fetchDeactivatedSummary();
  }, [dataTab, dateRange]);

  // Generate and download CSV data
  const downloadCSV = (type: 'traders' | 'trades' | 'daily') => {
    const generateTraderCSV = () => {
      const headers = ['User ID', 'Username', 'Email', 'Total Trades', 'Win Rate (%)', 
                       'Profit ($)', 'Profit (%)', 'Avg Hold Time (h)', 'Last Trade'];
      
      // Create CSV content manually with proper escaping
      let csvContent = headers.join(',') + '\n';
      
      traderStats.forEach(trader => {
        const row = [
          trader.user_id,
          escapeCsvValue(trader.username),
          escapeCsvValue(trader.email),
          trader.total_trades,
          trader.win_rate,
          trader.profit,
          trader.profit_percent,
          trader.avg_hold_time,
          trader.last_trade_date
        ];
        csvContent += row.join(',') + '\n';
      });
      
      return csvContent;
    };
    
    const fetchAndDownload = async (endpoint: string, filename: string) => {
      try {
        const response = await fetchWithIdentity(endpoint);
        if (response.ok) {
          const data = await response.json();
          let csvContent = '';
          
          if (type === 'traders') {
            csvContent = generateTraderCSV();
          } else {
            // For trades and daily, use the API data directly
            if (data.length > 0) {
              // Extract headers from first object
              const headers = Object.keys(data[0]);
              csvContent = headers.join(',') + '\n';
              
              // Add rows
              data.forEach((item: any) => {
                const row = headers.map(key => escapeCsvValue(item[key]));
                csvContent += row.join(',') + '\n';
              });
            }
          }
          
          downloadString(csvContent, filename);
        }
      } catch (error) {
        console.error(`Error downloading ${type} data:`, error);
      }
    };
    
    if (type === 'traders' && traderStats.length > 0) {
      const csvContent = generateTraderCSV();
      downloadString(csvContent, 'trader_statistics.csv');
    } else if (type === 'trades') {
      fetchAndDownload('/api/admin/all-trades', 'all_trades.csv');
    } else if (type === 'daily') {
      fetchAndDownload('/api/admin/daily-pnl', 'daily_pnl.csv');
    }
  };
  
  // Helper function to escape CSV values properly
  const escapeCsvValue = (value: any): string => {
    if (value === null || value === undefined) {
      return '';
    }
    
    const stringValue = String(value);
    
    // If the value contains commas, quotes, or newlines, wrap it in quotes and escape any existing quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return '"' + stringValue.replace(/"/g, '""') + '"';
    }
    
    return stringValue;
  };
  
  const downloadString = (content: string, filename: string, mimeType: string = 'text/csv;charset=utf-8;') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate and download JSONL data
  const downloadJSONL = (type: 'traders' | 'trades' | 'daily') => {
    const generateTraderJSONL = () => {
      return traderStats.map(trader => JSON.stringify({
        userId: trader.user_id,
        username: trader.username,
        email: trader.email,
        totalTrades: trader.total_trades,
        winRate: trader.win_rate,
        profit: trader.profit,
        profitPercent: trader.profit_percent,
        avgHoldTimeHours: trader.avg_hold_time,
        lastTradeDate: trader.last_trade_date,
        exportedAt: new Date().toISOString(),
      })).join('\n');
    };
    
    const fetchAndDownloadJSONL = async (endpoint: string, filename: string) => {
      try {
        const response = await fetchWithIdentity(endpoint);
        if (response.ok) {
          const data = await response.json();
          const jsonlContent = data.map((item: any) => JSON.stringify({
            ...item,
            exportedAt: new Date().toISOString(),
          })).join('\n');
          downloadString(jsonlContent, filename, 'application/x-ndjson');
        }
      } catch (error) {
        console.error(`Error downloading ${type} JSONL data:`, error);
      }
    };
    
    if (type === 'traders' && traderStats.length > 0) {
      const jsonlContent = generateTraderJSONL();
      downloadString(jsonlContent, 'trader_statistics.jsonl', 'application/x-ndjson');
    } else if (type === 'trades') {
      fetchAndDownloadJSONL('/api/admin/all-trades', 'all_trades.jsonl');
    } else if (type === 'daily') {
      fetchAndDownloadJSONL('/api/admin/daily-pnl', 'daily_pnl.jsonl');
    }
  };

  const downloadDeactivatedExport = (format: "csv" | "jsonl") => {
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("days", dateRange);
    params.set("includeTrades", "1");
    window.open(`/api/admin/deactivated-accounts/export?${params.toString()}`, "_blank");
  };

  // Format duration in hours to a readable string
  const formatDuration = (hours: number) => {
    if (hours < 1) {
      return `${Math.round(hours * 60)} min`;
    } else if (hours < 24) {
      return `${Math.round(hours)} hours`;
    } else {
      return `${Math.round(hours / 24)} days`;
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trading Data</h1>
          <p className="text-muted-foreground">
            Analytics, exports and trader performance metrics
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Period:</span>
          <Select
            value={dateRange}
            onValueChange={setDateRange}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
              <SelectItem value="0">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Mini-tabs */}
      <div className="flex gap-2 flex-wrap bg-neutral-800 p-2 rounded-lg">
        <button
          onClick={() => setDataTab("stats")}
          className={`px-3 py-1.5 rounded text-sm transition ${dataTab === "stats" ? "bg-primary text-white" : "text-gray-300 hover:bg-neutral-600"}`}
        >
          Stats & Exports
        </button>
        <button
          onClick={() => setDataTab("funnel")}
          className={`px-3 py-1.5 rounded text-sm transition ${dataTab === "funnel" ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
        >
          Signup Funnel
        </button>
        <button
          onClick={() => setDataTab("analytics")}
          className={`px-3 py-1.5 rounded text-sm transition ${dataTab === "analytics" ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
        >
          User Analytics
        </button>
        <button
          onClick={() => setDataTab("compliance")}
          className={`px-3 py-1.5 rounded text-sm transition ${dataTab === "compliance" ? "bg-rose-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
        >
          Verification Compliance
        </button>
        <button
          onClick={() => setDataTab("deactivated")}
          className={`px-3 py-1.5 rounded text-sm transition ${dataTab === "deactivated" ? "bg-amber-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
        >
          Deactivated Accounts
        </button>
      </div>

      {dataTab === "stats" ? (
        <>
        {/* KPI Hero Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="bg-gradient-to-br from-blue-900/50 to-blue-800/30 border-blue-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-blue-400" />
                <span className="text-xs text-blue-300">Total Users</span>
              </div>
              <div className="text-lg md:text-xl lg:text-2xl font-bold text-white truncate">{kpiData?.totalUsers?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-900/50 to-green-800/30 border-green-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-green-400" />
                <span className="text-xs text-green-300">Active Traders</span>
              </div>
              <div className="text-lg md:text-xl lg:text-2xl font-bold text-white truncate">{kpiData?.activeTraders?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-900/50 to-purple-800/30 border-purple-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-purple-400" />
                <span className="text-xs text-purple-300">Total Trades</span>
              </div>
              <div className="text-lg md:text-xl lg:text-2xl font-bold text-white truncate">{kpiData?.totalTrades?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-900/50 to-amber-800/30 border-amber-700">
            <CardContent className="p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-amber-400" />
                <span className="text-xs text-amber-300">Volume</span>
              </div>
              <div className="text-lg md:text-xl lg:text-2xl font-bold text-white">${formatCompactNumber(kpiData?.totalVolume || 0)}</div>
            </CardContent>
          </Card>
          <Card className={`bg-gradient-to-br ${(kpiData?.totalPnL || 0) >= 0 ? 'from-emerald-900/50 to-emerald-800/30 border-emerald-700' : 'from-red-900/50 to-red-800/30 border-red-700'}`}>
            <CardContent className="p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className={`h-4 w-4 ${(kpiData?.totalPnL || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`} />
                <span className={`text-xs ${(kpiData?.totalPnL || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>Total P/L</span>
              </div>
              <div className={`text-lg md:text-xl lg:text-2xl font-bold ${(kpiData?.totalPnL || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(kpiData?.totalPnL || 0) >= 0 ? '+' : ''}${formatCompactNumber(Math.abs(kpiData?.totalPnL || 0))}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-cyan-900/50 to-cyan-800/30 border-cyan-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                <span className="text-xs text-cyan-300">Avg Win Rate</span>
              </div>
              <div className="text-lg md:text-xl lg:text-2xl font-bold text-white truncate">{(kpiData?.avgWinRate || 0).toFixed(1)}%</div>
            </CardContent>
          </Card>
        </div>

        {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Raw Data Exports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Trader Statistics</span>
                <div className="flex gap-1">
                  <Button 
                    variant="csv" 
                    size="sm"
                    onClick={() => downloadCSV('traders')}
                  >
                    CSV
                  </Button>
                  <Button 
                    variant="jsonl" 
                    size="sm"
                    onClick={() => downloadJSONL('traders')}
                  >
                    JSONL
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">All Trades</span>
                <div className="flex gap-1">
                  <Button 
                    variant="csv" 
                    size="sm"
                    onClick={() => downloadCSV('trades')}
                  >
                    CSV
                  </Button>
                  <Button 
                    variant="jsonl" 
                    size="sm"
                    onClick={() => downloadJSONL('trades')}
                  >
                    JSONL
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Daily P&L</span>
                <div className="flex gap-1">
                  <Button 
                    variant="csv" 
                    size="sm"
                    onClick={() => downloadCSV('daily')}
                  >
                    CSV
                  </Button>
                  <Button 
                    variant="jsonl" 
                    size="sm"
                    onClick={() => downloadJSONL('daily')}
                  >
                    JSONL
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Platform Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap justify-center md:justify-around gap-8">
              <MiniDonut 
                value={aggStats.profitPercent}
                label="Avg. Profit %"
                format={(val) => `${(val * 100).toFixed(1)}%`}
              />
              <MiniDonut 
                value={aggStats.winRate}
                label="Win Rate"
                format={(val) => `${(val * 100).toFixed(1)}%`}
              />
              <MiniDonut 
                value={Math.min(1, aggStats.avgHoldTime / 48)} // Normalize to 0-1 (cap at 48h)
                label="Avg. Hold Time"
                format={() => formatDuration(aggStats.avgHoldTime)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trader Statistics Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg">Top Traders</CardTitle>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by name or email"
                className="w-60 h-8"
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
              </div>
            ) : filteredStats.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No trader data available
              </div>
            ) : (
              <LeaderboardTable 
                leaderboard={filteredStats.map((trader, index) => ({
                  rank: index + 1,
                  traderName: trader.username || "",
                  email: trader.email || "",
                  trades: Number(trader.total_trades) || 0,
                  winRate: parseFloat(trader.win_rate) || 0,
                  profitOrLoss: parseFloat(trader.profit) || 0,
                  profitPct: parseFloat(trader.profit_percent) || 0,
                  avgHoldHrs: parseFloat(trader.avg_hold_time) || 0,
                  lastTrade: trader.last_trade_date || new Date().toISOString()
                }))}
              />
            )}
          </div>
        </CardContent>
      </Card>
        </>
      ) : dataTab === "funnel" ? (
        /* Signup Funnel View */
        <div className="space-y-6">
          <Card className="bg-neutral-800 border-gray-600">
            <CardHeader>
              <CardTitle className="text-lg text-emerald-400">Signup Funnel Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Funnel visualization */}
                <div className="space-y-3">
                  {[
                    { label: "Total Signups", value: funnelData.totalSignups, color: "bg-emerald-600", width: "100%" },
                    { label: "Completed Profile", value: funnelData.completedProfiles, color: "bg-emerald-500", width: `${(funnelData.completedProfiles / (funnelData.totalSignups || 1)) * 100}%` },
                    { label: "First Trade", value: funnelData.firstTrade, color: "bg-teal-500", width: `${(funnelData.firstTrade / (funnelData.totalSignups || 1)) * 100}%` },
                    { label: "10+ Trades", value: funnelData.tenTrades, color: "bg-cyan-500", width: `${(funnelData.tenTrades / (funnelData.totalSignups || 1)) * 100}%` },
                    { label: "Profitable", value: funnelData.profitable, color: "bg-green-500", width: `${(funnelData.profitable / (funnelData.totalSignups || 1)) * 100}%` },
                  ].map((step, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">{step.label}</span>
                        <span className="text-white font-medium">{step.value.toLocaleString()}</span>
                      </div>
                      <div className="h-8 bg-neutral-700 rounded-lg overflow-hidden">
                        <div 
                          className={`h-full ${step.color} transition-all duration-500`}
                          style={{ width: step.width }}
                        />
                      </div>
                      {i > 0 && (
                        <div className="text-xs text-gray-400 text-right">
                          {((step.value / (funnelData.totalSignups || 1)) * 100).toFixed(1)}% of signups
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* Conversion metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-4 border-t border-gray-600">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-emerald-400">
                      {((funnelData.completedProfiles / (funnelData.totalSignups || 1)) * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">Profile Complete Rate</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-teal-400">
                      {((funnelData.firstTrade / (funnelData.totalSignups || 1)) * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">First Trade Rate</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-cyan-400">
                      {((funnelData.tenTrades / (funnelData.firstTrade || 1)) * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">Activation (10+ trades)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">
                      {((funnelData.profitable / (funnelData.tenTrades || 1)) * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">Profitable Traders</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : dataTab === "analytics" ? (
        /* User Analytics View */
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-neutral-800 border-gray-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-indigo-400">Active Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Daily Active</span>
                    <span className="text-xl font-bold text-white">{analyticsData.activeDaily}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Weekly Active</span>
                    <span className="text-xl font-bold text-white">{analyticsData.activeWeekly}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Monthly Active</span>
                    <span className="text-xl font-bold text-white">{analyticsData.activeMonthly}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-neutral-800 border-gray-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-indigo-400">Engagement</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Avg Session</span>
                    <span className="text-xl font-bold text-white">{analyticsData.avgSessionMinutes} min</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Trades/User</span>
                    <span className="text-xl font-bold text-white">{analyticsData.avgTradesPerUser.toFixed(1)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-neutral-800 border-gray-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-indigo-400">Retention</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">7-Day Retention</span>
                    <span className="text-xl font-bold text-white">{analyticsData.retentionD7.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">30-Day Retention</span>
                    <span className="text-xl font-bold text-white">{analyticsData.retentionD30.toFixed(1)}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-neutral-800 border-gray-600">
            <CardHeader>
              <CardTitle className="text-base">DAU/MAU Ratio (Stickiness)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex-1 bg-neutral-700 rounded-full h-4 overflow-hidden">
                  <div 
                    className="h-full bg-indigo-500"
                    style={{ width: `${(analyticsData.activeDaily / (analyticsData.activeMonthly || 1)) * 100}%` }}
                  />
                </div>
                <span className="text-2xl font-bold text-indigo-400">
                  {((analyticsData.activeDaily / (analyticsData.activeMonthly || 1)) * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Higher stickiness indicates users return frequently. Benchmark: 20%+ is excellent.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : dataTab === "compliance" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-green-900/50 to-green-800/30 border-green-700">
              <CardContent className="p-4">
                <div className="text-xs text-green-300 mb-1">Verified (Last 14 Days)</div>
                <div className="text-3xl font-bold text-green-400">{complianceData.verifiedWithin14Days}</div>
                <div className="text-xs text-gray-400 mt-1">New verifications</div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-amber-900/50 to-amber-800/30 border-amber-700">
              <CardContent className="p-4">
                <div className="text-xs text-amber-300 mb-1">Overdue Reverify</div>
                <div className="text-3xl font-bold text-amber-400">{complianceData.overdueReverify}</div>
                <div className="text-xs text-gray-400 mt-1">Need re-verification</div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-red-900/50 to-red-800/30 border-red-700">
              <CardContent className="p-4">
                <div className="text-xs text-red-300 mb-1">Locked Accounts</div>
                <div className="text-3xl font-bold text-red-400">{complianceData.lockedAccounts}</div>
                <div className="text-xs text-gray-400 mt-1">Disabled or frozen</div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-blue-900/50 to-blue-800/30 border-blue-700">
              <CardContent className="p-4">
                <div className="text-xs text-blue-300 mb-1">Pending KYC</div>
                <div className="text-3xl font-bold text-blue-400">{complianceData.pendingKyc}</div>
                <div className="text-xs text-gray-400 mt-1">Awaiting review</div>
              </CardContent>
            </Card>
          </div>
          
          <Card className="bg-neutral-800 border-gray-600">
            <CardHeader>
              <CardTitle className="text-base text-rose-400">Compliance Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">Verification Rate</span>
                    <span className="text-white font-medium">
                      {complianceData.totalUsers > 0 
                        ? ((complianceData.verifiedWithin14Days / complianceData.totalUsers) * 100).toFixed(1)
                        : 0}%
                    </span>
                  </div>
                  <div className="w-full bg-neutral-700 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${complianceData.totalUsers > 0 ? (complianceData.verifiedWithin14Days / complianceData.totalUsers) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">Account Lock Rate</span>
                    <span className="text-white font-medium">
                      {complianceData.totalUsers > 0 
                        ? ((complianceData.lockedAccounts / complianceData.totalUsers) * 100).toFixed(1)
                        : 0}%
                    </span>
                  </div>
                  <div className="w-full bg-neutral-700 rounded-full h-2">
                    <div 
                      className="bg-red-500 h-2 rounded-full"
                      style={{ width: `${complianceData.totalUsers > 0 ? (complianceData.lockedAccounts / complianceData.totalUsers) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                
                <p className="text-xs text-gray-500 pt-2">
                  Compliance metrics are calculated based on KYC status and account state. Verification rate shows users verified within the last 14 days.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : dataTab === "deactivated" ? (
        <div className="space-y-6">
          {deactivatedLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-400"></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <Card className="bg-gradient-to-br from-amber-900/50 to-amber-800/30 border-amber-700">
                  <CardContent className="p-4">
                    <div className="text-xs text-amber-300 mb-1">Total Accounts</div>
                    <div className="text-3xl font-bold text-amber-400">
                      {deactivatedSummary?.totals.total ?? 0}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">Deactivated or deleted</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-orange-900/50 to-orange-800/30 border-orange-700">
                  <CardContent className="p-4">
                    <div className="text-xs text-orange-300 mb-1">Deactivated</div>
                    <div className="text-3xl font-bold text-orange-400">
                      {deactivatedSummary?.totals.deactivated ?? 0}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">Self deactivation</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-red-900/50 to-red-800/30 border-red-700">
                  <CardContent className="p-4">
                    <div className="text-xs text-red-300 mb-1">Deleted</div>
                    <div className="text-3xl font-bold text-red-400">
                      {deactivatedSummary?.totals.deleted ?? 0}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">Self deletion</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700">
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-300 mb-1">Avg Profit</div>
                    <div className="text-2xl font-bold text-white">
                      {formatSignedCurrency(deactivatedSummary?.averages.profitUsd ?? 0)}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">Closed trades only</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700">
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-300 mb-1">Avg Trades</div>
                    <div className="text-2xl font-bold text-white">
                      {(deactivatedSummary?.averages.trades ?? 0).toFixed(1)}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">Closed trades</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700">
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-300 mb-1">Avg Win Rate</div>
                    <div className="text-2xl font-bold text-white">
                      {(deactivatedSummary?.averages.winRatePct ?? 0).toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400 mt-1">Closed trades</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="bg-neutral-800 border-gray-600">
                  <CardHeader>
                    <CardTitle className="text-base text-amber-400">Top Reasons</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {(deactivatedSummary?.reasons ?? []).length === 0 ? (
                        <div className="text-sm text-gray-400">No reasons recorded.</div>
                      ) : (
                        (deactivatedSummary?.reasons ?? []).slice(0, 10).map((r, index) => (
                          <div key={`${r.reasonCode || "NONE"}-${index}`} className="flex items-start justify-between gap-3">
                            <div className="text-sm text-gray-200">
                              <div className="font-medium">{r.reasonCode || "UNSPECIFIED"}</div>
                              {r.reasonText ? (
                                <div className="text-xs text-gray-400">{r.reasonText}</div>
                              ) : null}
                            </div>
                            <div className="text-sm text-gray-300">{r.count}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-neutral-800 border-gray-600 lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base text-amber-400">Top 5 Deactivated Accounts</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-300">
                            <th className="py-2 pr-4">User</th>
                            <th className="py-2 pr-4">Action</th>
                            <th className="py-2 pr-4">Profit</th>
                            <th className="py-2 pr-4">Trades</th>
                            <th className="py-2 pr-4">Win %</th>
                            <th className="py-2 pr-4">Reason</th>
                            <th className="py-2 pr-4">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(deactivatedSummary?.top ?? []).length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-3 text-gray-400">
                                No accounts in range.
                              </td>
                            </tr>
                          ) : (
                            (deactivatedSummary?.top ?? []).map((u) => {
                              const actionDate = u.actionAt ? parseDate(u.actionAt) : null;
                              return (
                                <tr key={u.userId} className="border-t border-gray-700">
                                  <td className="py-2 pr-4 text-gray-200">
                                    <div className="font-medium">{u.username || "(no username)"}</div>
                                    <div className="text-xs text-gray-400">{u.email || "no-email"}</div>
                                  </td>
                                  <td className="py-2 pr-4 text-gray-200">
                                    {u.mode === "DELETED" ? "Delete" : "Deactivate"}
                                  </td>
                                  <td className="py-2 pr-4 text-gray-200">
                                    {formatSignedCurrency(u.profitUsd)}
                                  </td>
                                  <td className="py-2 pr-4 text-gray-200">{u.trades}</td>
                                  <td className="py-2 pr-4 text-gray-200">{u.winRatePct.toFixed(1)}%</td>
                                  <td className="py-2 pr-4 text-gray-200">
                                    {u.reasonCode || "UNSPECIFIED"}
                                  </td>
                                  <td className="py-2 pr-4 text-gray-400">
                                    {actionDate ? actionDate.toLocaleDateString() : "N/A"}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-neutral-800 border-gray-600">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-amber-400">Exports</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="csv" size="sm" onClick={() => downloadDeactivatedExport("csv")}>
                      Export CSV
                    </Button>
                    <Button variant="jsonl" size="sm" onClick={() => downloadDeactivatedExport("jsonl")}>
                      Export JSONL
                    </Button>
                    <span className="text-xs text-gray-400">
                      Includes deactivated accounts and related trades.
                    </span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
