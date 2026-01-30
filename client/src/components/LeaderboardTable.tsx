import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Trophy, TrendingUp, TrendingDown } from "lucide-react";

export interface LeaderboardEntry {
  rank: number;
  traderName: string;
  email: string;
  trades: number;
  winRate: number;
  profitOrLoss: number;   // absolute $
  profitPct: number;      // %
  avgHoldHrs: number;
  lastTrade: string;      // ISO timestamp
}

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(amount));
};

interface LeaderboardTableProps {
  leaderboard: LeaderboardEntry[];
}

export function LeaderboardTable({ leaderboard }: LeaderboardTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
          <TableRow className="hover:bg-slate-50/80 dark:hover:bg-slate-800/60">
            <TableHead className="font-semibold">Rank</TableHead>
            <TableHead className="font-semibold">Trader</TableHead>
            <TableHead className="font-semibold">Email</TableHead>
            <TableHead className="text-right font-semibold">Trades</TableHead>
            <TableHead className="text-right font-semibold">Win&nbsp;Rate</TableHead>
            <TableHead className="text-right font-semibold min-w-[100px]">Profit/Loss</TableHead>
            <TableHead className="text-right font-semibold">Profit&nbsp;%</TableHead>
            <TableHead className="text-right font-semibold">Avg&nbsp;Hold</TableHead>
            <TableHead className="text-right font-semibold">Last&nbsp;Trade</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {leaderboard.map((e) => (
            <TableRow key={e.rank} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800">
              {/* ── Rank + Trophy icon ──────────────────────────────── */}
              <TableCell className="font-medium flex items-center gap-2">
                {e.rank <= 3 && (
                  <Trophy
                    size={18}
                    className={
                      e.rank === 1
                        ? "text-yellow-500"
                        : e.rank === 2
                          ? "text-slate-400"
                          : "text-orange-600"
                    }
                  />
                )}
                {e.rank}
              </TableCell>

              {/* ── Trader name ── */}
              <TableCell className="font-medium">{e.traderName}</TableCell>

              {/* ── Email ── */}
              <TableCell className="text-slate-600 dark:text-slate-400">{e.email}</TableCell>

              {/* ── Trades count ── */}
              <TableCell className="text-right">{e.trades}</TableCell>

              {/* ── Win Rate ── */}
              <TableCell className="text-right font-medium">
                {e.winRate.toFixed(2)}%
              </TableCell>

              {/* ── Profit/Loss with green up-wave or red down-wave ── */}
              <TableCell
                className={`text-right font-medium flex items-center justify-end gap-1 ${e.profitOrLoss >= 0 ? "text-green-500" : "text-red-500"
                  }`}
              >
                {e.profitOrLoss >= 0 ? (
                  <TrendingUp size={16} className="text-green-500" />
                ) : (
                  <TrendingDown size={16} className="text-red-500" />
                )}
                {formatCurrency(e.profitOrLoss)}
              </TableCell>

              {/* ── Profit % ── */}
              <TableCell
                className={`text-right font-medium ${e.profitPct >= 0 ? "text-green-500" : "text-red-500"
                  }`}
              >
                {e.profitPct >= 0 ? '+' : ''}{e.profitPct.toFixed(2)}%
              </TableCell>

              {/* ── Average hold time ── */}
              <TableCell className="text-right text-slate-700 dark:text-slate-300">
                {e.avgHoldHrs.toFixed(1)} h
              </TableCell>

              {/* ── Last trade date ── */}
              <TableCell className="text-right text-slate-700 dark:text-slate-300">
                {new Date(e.lastTrade).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}