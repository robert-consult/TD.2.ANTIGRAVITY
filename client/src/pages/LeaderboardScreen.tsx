import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChallengesCompetePanel from "@/components/trader/ChallengesCompetePanel";
import { Trophy, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usePerfHints } from "@/lib/perfHints";
import { resolveRuntimeIntervals } from "@/lib/runtimeIntervals";
import { usePerformanceSettings } from "@/hooks/use-performance-settings";

const LEADERBOARD_MODES = ["PUBLIC", "TOP_10", "DISABLED"] as const;

type LeaderboardItem = {
  userId: number;
  username: string;
  profit: number;
  winRate: number;
  totalTrades: number;
};

type LeaderboardModeResp = {
  ok: boolean;
  leaderboardMode: (typeof LEADERBOARD_MODES)[number];
  traderProProfilesEnabled: boolean;
  traderCompeteEnabled: boolean;
  traderCommunityEnabled: boolean;
};

type TraderProfileRow = {
  userId: number;
  bio: string | null;
  strategy: string | null;
  pinnedTradeIds: number[];
  updatedAt: number | null;
};

type LeaderboardSubTab = "leaderboard" | "resume" | "compete" | "community";

type LeaderboardTabDescriptor = {
  value: LeaderboardSubTab;
  label: string;
};

function formatWhen(utcSec: number | null | undefined): string {
  if (!utcSec || !Number.isFinite(utcSec)) return "-";
  return new Date(utcSec * 1000).toLocaleString();
}

export default function LeaderboardScreen() {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<LeaderboardSubTab>("leaderboard");
  const { user } = useAuth();
  const perfHints = usePerfHints();
  const performanceSettings = usePerformanceSettings();
  const runtimeIntervals = useMemo(
    () => resolveRuntimeIntervals(perfHints, performanceSettings),
    [perfHints, performanceSettings],
  );

  const { data: config } = useQuery<LeaderboardModeResp>({
    queryKey: ["/api/trader/leaderboard-mode"],
    refetchInterval: runtimeIntervals.leaderboard.modePollMs,
  });

  const leaderboardMode = config?.leaderboardMode ?? "PUBLIC";
  const proProfilesEnabled = Boolean(config?.traderProProfilesEnabled);
  const competeEnabled = Boolean(config?.traderCompeteEnabled);
  const communityEnabled = Boolean(config?.traderCommunityEnabled);
  const visibleTabs = useMemo<LeaderboardTabDescriptor[]>(() => {
    const tabs: LeaderboardTabDescriptor[] = [{ value: "leaderboard", label: "Leaderboard" }];
    if (proProfilesEnabled) tabs.push({ value: "resume", label: "My Resume" });
    if (competeEnabled) tabs.push({ value: "compete", label: "Compete" });
    if (communityEnabled) tabs.push({ value: "community", label: "Community" });
    return tabs;
  }, [communityEnabled, competeEnabled, proProfilesEnabled]);

  const { data: leaderboard = [], isLoading: leaderboardLoading } = useQuery<LeaderboardItem[]>({
    queryKey: ["/api/leaderboard"],
    refetchInterval: runtimeIntervals.leaderboard.entriesPollMs,
  });

  const profileQuery = useQuery<{ row: TraderProfileRow }>({
    queryKey: ["/api/trader/profile"],
    queryFn: () => axios.get("/api/trader/profile").then((r) => r.data),
    enabled: proProfilesEnabled,
    refetchOnWindowFocus: false,
  });

  const [profileDraft, setProfileDraft] = useState({ bio: "", strategy: "", pinnedTradeIds: "" });

  useEffect(() => {
    const row = profileQuery.data?.row;
    if (!row) return;
    setProfileDraft({
      bio: row.bio ?? "",
      strategy: row.strategy ?? "",
      pinnedTradeIds: (row.pinnedTradeIds ?? []).join(","),
    });
  }, [profileQuery.data?.row]);

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.value === subTab)) return;
    setSubTab(visibleTabs[0]?.value ?? "leaderboard");
  }, [subTab, visibleTabs]);

  const saveProfileMutation = useMutation({
    mutationFn: () => {
      const pinnedTradeIds = profileDraft.pinnedTradeIds
        .split(",")
        .map((v) => Number(String(v).trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 50);

      return axios
        .put("/api/trader/profile", {
          bio: profileDraft.bio,
          strategy: profileDraft.strategy,
          pinnedTradeIds,
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trader/profile"] });
    },
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

  const leaderboardSubtitle = useMemo(() => {
    if (leaderboardMode === "TOP_10") return "Ranking based on overall profit/loss. Showing top 10 only.";
    if (leaderboardMode === "DISABLED") return "Leaderboard is currently disabled by admin.";
    return "Ranking based on overall profit/loss.";
  }, [leaderboardMode]);

  const myRank = useMemo(() => {
    if (!user?.id || leaderboardMode === "DISABLED") return null;
    const index = leaderboard.findIndex((item) => Number(item.userId) === Number(user.id));
    return index >= 0 ? index + 1 : null;
  }, [leaderboard, leaderboardMode, user?.id]);

  return (
    <div className="tq-leaderboard-screen h-full flex flex-col bg-neutral-900 overflow-auto">
      <div className="tq-panel-header tq-page-header">
        <h1 className="tq-page-title text-[clamp(0.95rem,3vw,1rem)]">Talent</h1>
      </div>

      <div className="flex-1 page-pad">
        <div className="tq-leaderboard-shell bg-neutral-800 rounded-lg p-3 sm:p-card max-w-5xl w-full mx-auto space-y-3">
          <Tabs value={subTab} onValueChange={(value) => setSubTab(value as LeaderboardSubTab)} className="space-y-3">
            <TabsList
              className="tq-leaderboard-tabs bg-neutral-700 w-full h-auto p-1 grid gap-1 items-stretch"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleTabs.length)}, minmax(0, 1fr))` }}
            >
              {visibleTabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="tq-leaderboard-tab data-[state=active]:bg-neutral-600 text-[clamp(0.72rem,2.2vw,1rem)] px-1.5 sm:px-2 py-1.5 min-h-[2.35rem] whitespace-normal break-words leading-tight text-center"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="leaderboard" className="tq-leaderboard-content space-y-3">
              <div className="mb-3 sm:mb-4">
                <div className="flex items-center gap-2 text-white text-[clamp(0.78rem,2.2vw,1rem)] font-semibold">
                  <Trophy className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  <h2 className="leading-none">Top Traders</h2>
                </div>
                <p className="mt-1 text-[clamp(0.68rem,1.9vw,1rem)] text-gray-400">{leaderboardSubtitle}</p>
                <p className="mt-1 text-[clamp(0.68rem,1.9vw,1rem)] text-amber-300">
                  {leaderboardMode === "DISABLED"
                    ? "My Rank: unavailable while leaderboard is disabled."
                    : myRank
                      ? `My Rank: #${myRank}`
                      : leaderboardMode === "TOP_10"
                        ? "My Rank: not currently in Top 10."
                        : "My Rank: not currently ranked."}
                </p>
              </div>

              <div className="tq-leaderboard-table-wrap overflow-x-auto">
                <table className="tq-leaderboard-table w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs md:text-sm font-medium text-gray-400">Rank</th>
                      <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs md:text-sm font-medium text-gray-400">Trader</th>
                      <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs md:text-sm font-medium text-gray-400"><span className="hidden sm:inline">Profit/</span>P/L</th>
                      <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs md:text-sm font-medium text-gray-400"><span className="hidden sm:inline">Win </span>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardLoading && (
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

                    {!leaderboardLoading && leaderboardMode !== "DISABLED" && leaderboard.map((leader, index) => {
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
                                className={`h-3 w-3 sm:h-4 sm:w-4 ${leader.profit >= 0 ? "text-green-500" : "text-red-500"}`}
                              />
                              <span className={`font-medium text-xs sm:text-sm ${leader.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                                ${Math.abs(leader.profit).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 sm:py-4 px-2 sm:px-4">
                            <span className="text-gray-300 text-xs sm:text-sm">{leader.winRate.toFixed(0)}%</span>
                          </td>
                        </tr>
                      );
                    })}

                    {!leaderboardLoading && leaderboardMode !== "DISABLED" && leaderboard.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-400">
                          No traders on the leaderboard yet
                        </td>
                      </tr>
                    )}

                    {!leaderboardLoading && leaderboardMode === "DISABLED" && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-400">
                          Leaderboard is disabled
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="resume" className="tq-leaderboard-content space-y-3">
              {!proProfilesEnabled ? (
                <div className="tq-leaderboard-empty text-sm text-gray-400">Pro profile is disabled by admin.</div>
              ) : (
                <div className="tq-leaderboard-panel space-y-3">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Bio</div>
                    <Textarea
                      value={profileDraft.bio}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, bio: e.target.value }))}
                      className="tq-leaderboard-input bg-neutral-700 border-neutral-600 min-h-[110px]"
                      placeholder="Summary of your trading background"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Strategy</div>
                    <Textarea
                      value={profileDraft.strategy}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, strategy: e.target.value }))}
                      className="tq-leaderboard-input bg-neutral-700 border-neutral-600 min-h-[110px]"
                      placeholder="Core strategy, risk approach, and market focus"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Pinned Trade IDs (comma-separated)</div>
                    <Input
                      value={profileDraft.pinnedTradeIds}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, pinnedTradeIds: e.target.value }))}
                      className="tq-leaderboard-input bg-neutral-700 border-neutral-600"
                      placeholder="123,456,789"
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="text-xs text-gray-500">
                      Last updated: {formatWhen(profileQuery.data?.row?.updatedAt ?? null)}
                    </div>
                    <Button onClick={() => saveProfileMutation.mutate()} disabled={saveProfileMutation.isPending}>
                      {saveProfileMutation.isPending ? "Saving..." : "Save Resume"}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="compete" className="tq-leaderboard-content space-y-3">
              <ChallengesCompetePanel competeEnabled={competeEnabled} />
            </TabsContent>

            <TabsContent value="community" className="tq-leaderboard-content space-y-3">
              {!communityEnabled ? (
                <div className="tq-leaderboard-empty text-sm text-gray-400">Community mode is disabled by admin.</div>
              ) : (
                <div className="tq-leaderboard-panel space-y-3">
                  <div className="tq-leaderboard-community rounded border border-neutral-700 p-3">
                    <div className="text-xs text-gray-400 mb-1">Daily Briefing</div>
                    <div className="text-sm text-gray-200">
                      Top momentum is concentrated in current leaderboard leaders. Review your risk plan before
                      replicating high-volatility sessions.
                    </div>
                  </div>
                  <div className="tq-leaderboard-community rounded border border-neutral-700 p-3">
                    <div className="text-xs text-gray-400 mb-2">Spectator Board (Top 5)</div>
                    <div className="space-y-1 text-sm">
                      {(leaderboard || []).slice(0, 5).map((row, idx) => (
                        <div key={row.userId} className="tq-leaderboard-community-row flex items-center justify-between gap-3">
                          <span>
                            #{idx + 1} {row.username}
                          </span>
                          <span className={row.profit >= 0 ? "text-emerald-400" : "text-red-400"}>
                            {row.profit >= 0 ? "+" : "-"}${Math.abs(row.profit).toLocaleString("en-US")}
                          </span>
                        </div>
                      ))}
                      {!leaderboardLoading && leaderboard.length === 0 && (
                        <div className="text-gray-400">No active spectator streams right now.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
