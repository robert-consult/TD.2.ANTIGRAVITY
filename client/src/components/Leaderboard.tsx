import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

type LeaderboardItem = {
  userId: number;
  username: string;
  profit: number;
};

export function Leaderboard() {
  const { data: leaderboard = [], isLoading } = useQuery<LeaderboardItem[]>({
    queryKey: ["/api/leaderboard"],
    refetchInterval: 30000, // Refresh every 30 seconds
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
          leaderboard.map((leader: LeaderboardItem, index: number) => (
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
                  leader.profit >= 0 ? "text-success-500" : "text-danger-500"
                }`}
              >
                {leader.profit >= 0 ? "+" : ""}
                {leader.profit.toFixed(1)}%
              </div>
            </div>
          ))}

        {leaderboard && leaderboard.length === 0 && (
          <div className="text-center py-4 text-sm text-gray-400">
            No traders yet
          </div>
        )}
      </div>
    </div>
  );
}
