import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo } from "react";
import { usePerfHints } from "@/lib/perfHints";
import { resolveRuntimeIntervals } from "@/lib/runtimeIntervals";
import { usePerformanceSettings } from "@/hooks/use-performance-settings";

type LeaderboardItem = {
  userId: number;
  username: string;
  profit: number;
  profitPct?: number;
};

export function Leaderboard() {
  const perfHints = usePerfHints();
  const performanceSettings = usePerformanceSettings();
  const runtimeIntervals = useMemo(
    () => resolveRuntimeIntervals(perfHints, performanceSettings),
    [perfHints, performanceSettings],
  );
  const { data: leaderboard = [], isLoading } = useQuery<LeaderboardItem[]>({
    queryKey: ["/api/leaderboard"],
    refetchInterval: runtimeIntervals.leaderboard.entriesPollMs,
  });

  return (
    <div className="mt-8 px-3">
      <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Leaderboard
      </h3>
      <div className="mt-2 space-y-1">
        {isLoading && (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center px-3 py-2">
                <div className="mr-2 w-5 text-center">
                  <Skeleton className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <Skeleton className="h-4 w-20" />
                </div>
                <div>
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            ))}
          </>
        )}

        {leaderboard &&
          leaderboard.map((leader: LeaderboardItem, index: number) => {
            const pct = Number.isFinite(leader.profitPct)
              ? Number(leader.profitPct)
              : (Number(leader.profit) / 1_000_000) * 100;

            return (
              <div
                key={leader.userId}
                className="flex items-center px-3 py-2 text-sm text-gray-300"
              >
                <div className="mr-2 w-5 text-center font-medium text-gray-500">
                  {index + 1}
                </div>
                <div className="flex-1 truncate">{leader.username}</div>
                <div
                  className={`font-mono ${
                    pct >= 0 ? "text-success-500" : "text-danger-500"
                  }`}
                >
                  {pct >= 0 ? "+" : ""}
                  {pct.toFixed(1)}%
                </div>
              </div>
            );
          })}

        {leaderboard && leaderboard.length === 0 && (
          <div className="text-center py-4 text-sm text-gray-400">
            No traders yet
          </div>
        )}
      </div>
    </div>
  );
}
