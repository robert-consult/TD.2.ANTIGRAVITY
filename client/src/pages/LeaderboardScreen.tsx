import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, TrendingUp } from "lucide-react";

type LeaderboardItem = {
  userId: number;
  username: string;
  profit: number;
  winRate: number;
  totalTrades: number;
};

export default function LeaderboardScreen() {
  const { data: leaderboard = [], isLoading } = useQuery<LeaderboardItem[]>({
    queryKey: ["/api/leaderboard"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const getTrophyColor = (rank: number) => {
    switch (rank) {
      case 1:
        return "text-yellow-500";
      case 2:
        return "text-gray-400";
      case 3:
        return "text-amber-600";
      default:
        return "text-gray-600";
    }
  };

  return (
    <div className="h-full flex flex-col bg-neutral-900 overflow-auto">
      <div className="tq-page-header">
        <h1 className="tq-page-title">Leaderboard</h1>
      </div>

      <div className="flex-1 page-pad">
        <div className="bg-neutral-800 rounded-lg p-3 sm:p-card max-w-4xl w-full mx-auto">
          <div className="mb-3 sm:mb-4">
            <div className="flex items-center gap-2 text-white text-sm sm:text-base font-semibold">
              <Trophy className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              <h2 className="leading-none">Top Traders</h2>
            </div>
            <p className="mt-1 text-[10px] sm:text-xs md:text-sm text-gray-400">Ranking based on overall profit/loss.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs md:text-sm font-medium text-gray-400">Rank</th>
                  <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs md:text-sm font-medium text-gray-400">Trader</th>
                  <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs md:text-sm font-medium text-gray-400"><span className="hidden sm:inline">Profit/</span>P/L</th>
                  <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs md:text-sm font-medium text-gray-400"><span className="hidden sm:inline">Win </span>Rate</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} className="border-b border-gray-700/50">
                        <td className="py-3 sm:py-4 px-2 sm:px-4">
                          <Skeleton className="h-5 w-8" />
                        </td>
                        <td className="py-3 sm:py-4 px-2 sm:px-4">
                          <Skeleton className="h-5 w-32" />
                        </td>
                        <td className="py-3 sm:py-4 px-2 sm:px-4">
                          <Skeleton className="h-5 w-24" />
                        </td>
                        <td className="py-3 sm:py-4 px-2 sm:px-4">
                          <Skeleton className="h-5 w-16" />
                        </td>
                      </tr>
                    ))}
                  </>
                )}

                {!isLoading && leaderboard.map((leader, index) => {
                  const rank = index + 1;
                  const showTrophy = rank <= 3;

                  return (
                    <tr
                      key={leader.userId}
                      className="border-b border-gray-700/50 hover:bg-neutral-700/30 transition-colors"
                    >
                      <td className="py-3 sm:py-4 px-2 sm:px-4">
                        <div className="flex items-center gap-1 sm:gap-2">
                          {showTrophy && (
                            <Trophy className={`h-4 w-4 sm:h-5 sm:w-5 ${getTrophyColor(rank)}`} />
                          )}
                          <span className="text-white font-medium text-xs sm:text-sm">{rank}</span>
                        </div>
                      </td>
                      <td className="py-3 sm:py-4 px-2 sm:px-4">
                        <span className="text-white text-xs sm:text-sm truncate max-w-[80px] sm:max-w-none block">{leader.username}</span>
                      </td>
                      <td className="py-3 sm:py-4 px-2 sm:px-4">
                        <div className="flex items-center gap-1">
                          <TrendingUp
                            className={`h-3 w-3 sm:h-4 sm:w-4 ${leader.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}
                          />
                          <span className={`font-medium text-xs sm:text-sm ${leader.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            ${Math.abs(leader.profit).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 sm:py-4 px-2 sm:px-4">
                        <span className="text-gray-300 text-xs sm:text-sm">{leader.winRate.toFixed(0)}%</span>
                      </td>
                    </tr>
                  );
                })}

                {!isLoading && leaderboard.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-400">
                      No traders on the leaderboard yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
