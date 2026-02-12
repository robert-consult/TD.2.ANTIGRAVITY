import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AnyRow = Record<string, any>;

type Props = {
  competeEnabled: boolean;
};

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value: unknown, fallback = 0): number {
  return Math.trunc(toNum(value, fallback));
}

function formatPct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function formatWhen(utcSec: unknown): string {
  const n = Number(utcSec);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Date(n * 1000).toLocaleString();
}

function statusVariant(status: unknown): "default" | "secondary" | "destructive" | "outline" {
  const s = String(status || "").toUpperCase();
  if (s === "PASSED" || s === "COMPLETED") return "default";
  if (s === "FAILED" || s === "DISQUALIFIED") return "destructive";
  if (s === "ACTIVE") return "secondary";
  return "outline";
}

function formatUsd(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString()}`;
}

export default function ChallengesCompetePanel({ competeEnabled }: Props) {
  const queryClient = useQueryClient();
  const [view, setView] = useState("browse");
  const [selectedChallengeId, setSelectedChallengeId] = useState<number | null>(null);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<number | null>(null);

  const challengesQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges"],
    queryFn: () => axios.get("/api/trader/challenges").then((r) => r.data),
    enabled: competeEnabled,
    refetchOnWindowFocus: false,
  });

  const enrollmentsQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/my-enrollments"],
    queryFn: () => axios.get("/api/trader/challenges/my-enrollments").then((r) => r.data),
    enabled: competeEnabled,
    refetchOnWindowFocus: false,
  });

  const badgesQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/my-badges"],
    queryFn: () => axios.get("/api/trader/challenges/my-badges").then((r) => r.data),
    enabled: competeEnabled && view === "rewards",
    refetchOnWindowFocus: false,
  });

  const certsQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/my-certificates"],
    queryFn: () => axios.get("/api/trader/challenges/my-certificates").then((r) => r.data),
    enabled: competeEnabled && view === "rewards",
    refetchOnWindowFocus: false,
  });

  const progressionQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/my-progression"],
    queryFn: () => axios.get("/api/trader/challenges/my-progression").then((r) => r.data),
    enabled: competeEnabled && view === "rewards",
    refetchOnWindowFocus: false,
  });

  const challengeDetailQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/detail", selectedChallengeId],
    queryFn: () => axios.get(`/api/trader/challenges/${selectedChallengeId}`).then((r) => r.data),
    enabled: competeEnabled && selectedChallengeId != null,
    refetchOnWindowFocus: false,
  });

  const leaderboardQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/leaderboard", selectedChallengeId],
    queryFn: () => axios.get(`/api/trader/challenges/${selectedChallengeId}/leaderboard`).then((r) => r.data),
    enabled: competeEnabled && view === "leaderboard" && selectedChallengeId != null,
    refetchOnWindowFocus: false,
  });

  const rewardsByChallengeQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/rewards", selectedChallengeId],
    queryFn: () => axios.get(`/api/trader/challenges/${selectedChallengeId}/my-rewards`).then((r) => r.data),
    enabled: competeEnabled && view === "rewards" && selectedChallengeId != null,
    refetchOnWindowFocus: false,
  });

  const enrollmentDetailQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/enrollment/detail", selectedEnrollmentId],
    queryFn: () => axios.get(`/api/trader/challenges/enrollment/${selectedEnrollmentId}`).then((r) => r.data),
    enabled: competeEnabled && selectedEnrollmentId != null,
    refetchOnWindowFocus: false,
  });

  const enrollmentEventsQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/enrollment/events", selectedEnrollmentId],
    queryFn: () => axios.get(`/api/trader/challenges/enrollment/${selectedEnrollmentId}/events`).then((r) => r.data),
    enabled: competeEnabled && selectedEnrollmentId != null,
    refetchOnWindowFocus: false,
  });

  const enrollmentTradesQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges/enrollment/trades", selectedEnrollmentId],
    queryFn: () => axios.get(`/api/trader/challenges/enrollment/${selectedEnrollmentId}/trades?limit=150`).then((r) => r.data),
    enabled: competeEnabled && selectedEnrollmentId != null,
    refetchOnWindowFocus: false,
  });

  const enrollMutation = useMutation({
    mutationFn: (challengeId: number) => axios.post(`/api/trader/challenges/${challengeId}/enroll`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges/my-enrollments"] });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: (challengeId: number) => axios.post(`/api/trader/challenges/${challengeId}/withdraw`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges/my-enrollments"] });
      if (selectedEnrollmentId) {
        queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges/enrollment/detail", selectedEnrollmentId] });
      }
    },
  });

  const challenges = (challengesQuery.data?.rows ?? []) as AnyRow[];
  const myEnrollments = (enrollmentsQuery.data?.rows ?? []) as AnyRow[];
  const badges = (badgesQuery.data?.rows ?? []) as AnyRow[];
  const certificates = (certsQuery.data?.rows ?? []) as AnyRow[];

  useEffect(() => {
    if (selectedChallengeId) return;
    const firstId = toInt(challenges[0]?.id, 0);
    if (firstId > 0) setSelectedChallengeId(firstId);
  }, [selectedChallengeId, challenges]);

  useEffect(() => {
    if (selectedEnrollmentId) return;
    const first = toInt(myEnrollments[0]?.id, 0);
    if (first > 0) setSelectedEnrollmentId(first);
  }, [selectedEnrollmentId, myEnrollments]);

  const challengeById = useMemo(() => new Map(challenges.map((row) => [toInt(row.id, 0), row])), [challenges]);

  if (!competeEnabled) {
    return <div className="text-sm text-gray-400">Challenges are disabled by admin.</div>;
  }

  const selectedChallenge = selectedChallengeId ? challengeById.get(selectedChallengeId) : null;
  const selectedEnrollment = enrollmentDetailQuery.data?.enrollment as AnyRow | undefined;
  const selectedEnrollmentChallenge = enrollmentDetailQuery.data?.challenge as AnyRow | undefined;
  const selectedEnrollmentPhase = enrollmentDetailQuery.data?.phase as AnyRow | undefined;
  const selectedEnrollmentEvents = (enrollmentEventsQuery.data?.events ?? []) as AnyRow[];
  const selectedEnrollmentTrades = (enrollmentTradesQuery.data?.trades ?? []) as AnyRow[];

  return (
    <div className="space-y-3" data-testid="trader-compete-panel">
      <Tabs value={view} onValueChange={setView} className="space-y-3">
        <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-2 md:grid-cols-4 gap-1">
          <TabsTrigger value="browse" className="data-[state=active]:bg-neutral-600 text-xs">Browse</TabsTrigger>
          <TabsTrigger value="my" className="data-[state=active]:bg-neutral-600 text-xs">My Challenges</TabsTrigger>
          <TabsTrigger value="leaderboard" className="data-[state=active]:bg-neutral-600 text-xs">Leaderboard</TabsTrigger>
          <TabsTrigger value="rewards" className="data-[state=active]:bg-neutral-600 text-xs">Rewards</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {challenges.map((row) => {
              const isActive = String(row.enrollment_status || "") === "ACTIVE";
              return (
                <Card key={row.id} className="bg-neutral-900/50 border-neutral-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>{row.name}</span>
                      <Badge variant={statusVariant(row.enrollment_status || "NOT_ENROLLED")}>{row.enrollment_status || "NOT_ENROLLED"}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="text-gray-300">{row.description || "No description."}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded border border-neutral-700 p-2">Target: {formatPct(row.profit_target_pct)}</div>
                      <div className="rounded border border-neutral-700 p-2">Daily Loss: {formatPct(row.max_daily_loss_pct)}</div>
                      <div className="rounded border border-neutral-700 p-2">Duration: {toInt(row.duration_days, 0)}d</div>
                      <div className="rounded border border-neutral-700 p-2">Current PnL: {formatPct(row.current_pnl_pct)}</div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => setSelectedChallengeId(toInt(row.id, 0))}>Details</Button>
                      {isActive ? (
                        <Button size="sm" variant="outline" className="border-neutral-600" disabled={withdrawMutation.isPending} onClick={() => withdrawMutation.mutate(toInt(row.id, 0))}>Withdraw</Button>
                      ) : (
                        <Button size="sm" disabled={enrollMutation.isPending} onClick={() => enrollMutation.mutate(toInt(row.id, 0))}>Enroll</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {!challengesQuery.isLoading && challenges.length === 0 ? (
              <Card className="bg-neutral-900/50 border-neutral-700"><CardContent className="pt-6 text-sm text-gray-400">No challenges currently available.</CardContent></Card>
            ) : null}
          </div>

          {challengeDetailQuery.data?.challenge ? (
            <Card className="bg-neutral-900/50 border-neutral-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Challenge Detail: {challengeDetailQuery.data.challenge.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {(challengeDetailQuery.data?.phases ?? []).map((phase: AnyRow) => (
                    <div key={phase.id} className="rounded border border-neutral-700 p-2">
                      <div className="font-semibold">{phase.phaseName || `Phase ${phase.phaseNumber}`}</div>
                      <div>Target: {formatPct(phase.profitTargetPct)}</div>
                      <div>Daily: {formatPct(phase.maxDailyLossPct)}</div>
                      <div>Total: {formatPct(phase.maxTotalLossPct)}</div>
                      <div>Duration: {toInt(phase.durationDays, 0)}d</div>
                      <div>Min Days: {toInt(phase.minTradingDays, 0)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="my" className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myEnrollments.map((row) => {
              const challenge = challengeById.get(toInt(row.challengeId, 0));
              const target = toNum(challenge?.profit_target_pct, 0.1);
              const daily = toNum(challenge?.max_daily_loss_pct, 0.03);
              const pnl = toNum(row.currentPnlPct, 0);
              const pnlProgress = target > 0 ? Math.max(0, Math.min(100, (pnl / target) * 100)) : 0;
              const dailyProgress = daily > 0 ? Math.max(0, Math.min(100, (toNum(row.maxDailyLossHit, 0) / daily) * 100)) : 0;
              return (
                <Card key={row.id} className="bg-neutral-900/50 border-neutral-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>{row.name || `Challenge #${row.challengeId}`}</span>
                      <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded border border-neutral-700 p-2">Attempt #{toInt(row.attemptNumber, 1)}</div>
                      <div className="rounded border border-neutral-700 p-2">Phase {toInt(row.currentPhase, 1)}</div>
                      <div className="rounded border border-neutral-700 p-2">Enrolled {formatWhen(row.enrolledAt)}</div>
                      <div className="rounded border border-neutral-700 p-2">Trading Days {toInt(row.tradingDays, 0)}</div>
                    </div>
                    <div>
                      <div className="text-xs flex justify-between"><span>PnL Gauge</span><span>{formatPct(row.currentPnlPct)}</span></div>
                      <Progress className="h-2" value={pnlProgress} />
                    </div>
                    <div>
                      <div className="text-xs flex justify-between"><span>Daily Loss Gauge</span><span>{formatPct(row.maxDailyLossHit)}</span></div>
                      <Progress className="h-2" value={dailyProgress} />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => { setSelectedEnrollmentId(toInt(row.id, 0)); setView("my"); }}>
                        Open
                      </Button>
                      {String(row.status || "").toUpperCase() === "ACTIVE" ? (
                        <Button size="sm" variant="outline" className="border-neutral-600" disabled={withdrawMutation.isPending} onClick={() => withdrawMutation.mutate(toInt(row.challengeId, 0))}>
                          Withdraw
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {!enrollmentsQuery.isLoading && myEnrollments.length === 0 ? (
              <Card className="bg-neutral-900/50 border-neutral-700"><CardContent className="pt-6 text-sm text-gray-400">No enrollments yet.</CardContent></Card>
            ) : null}
          </div>

          {selectedEnrollment ? (
            <Card className="bg-neutral-900/50 border-neutral-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Enrollment Detail #{selectedEnrollment.id}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div className="rounded border border-neutral-700 p-2">Challenge: {selectedEnrollmentChallenge?.name || "-"}</div>
                  <div className="rounded border border-neutral-700 p-2">Status: {String(selectedEnrollment.status || "-")}</div>
                  <div className="rounded border border-neutral-700 p-2">Phase: {toInt(selectedEnrollment.currentPhase, 1)}</div>
                  <div className="rounded border border-neutral-700 p-2">Attempt: #{toInt(selectedEnrollment.attemptNumber, 1)}</div>
                </div>
                {selectedEnrollmentPhase ? (
                  <div className="rounded border border-neutral-700 p-2">
                    <div className="font-medium">{selectedEnrollmentPhase.phaseName || `Phase ${selectedEnrollmentPhase.phaseNumber}`}</div>
                    <div>Target {formatPct(selectedEnrollmentPhase.profitTargetPct)} | Daily {formatPct(selectedEnrollmentPhase.maxDailyLossPct)} | Total {formatPct(selectedEnrollmentPhase.maxTotalLossPct)}</div>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="rounded border border-neutral-700 p-2"><div className="text-gray-400 mb-1">Event Timeline</div><div className="max-h-56 overflow-auto space-y-1">{selectedEnrollmentEvents.slice(0, 120).map((event) => <div key={event.id} className="rounded border border-neutral-700 p-2"><div className="flex justify-between"><span>{String(event.eventType || "EVENT")}</span><span className="text-gray-500">{formatWhen(event.eventAt)}</span></div>{event.note ? <div className="text-gray-300">{String(event.note)}</div> : null}</div>)}{selectedEnrollmentEvents.length === 0 ? <div className="text-gray-500">No events.</div> : null}</div></div>
                  <div className="rounded border border-neutral-700 p-2"><div className="text-gray-400 mb-1">Trade Log</div><div className="max-h-56 overflow-auto space-y-1">{selectedEnrollmentTrades.slice(0, 120).map((trade) => <div key={trade.id} className="rounded border border-neutral-700 p-2 flex items-center justify-between"><span>{String(trade.symbol || "?")} {String(trade.type || "")}</span><span className={toNum(trade.netProfitUsd, 0) >= 0 ? "text-emerald-400" : "text-red-400"}>{formatUsd(trade.netProfitUsd)}</span></div>)}{selectedEnrollmentTrades.length === 0 ? <div className="text-gray-500">No trades in window.</div> : null}</div></div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="leaderboard" className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select value={selectedChallengeId ?? ""} onChange={(e) => setSelectedChallengeId(toInt(e.target.value, 0) || null)} className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm">
              {challenges.map((row) => <option key={row.id} value={row.id}>#{row.id} {row.name}</option>)}
            </select>
            <Input readOnly value={selectedChallenge ? `${selectedChallenge.name} (${selectedChallenge.leaderboard_enabled ? "Enabled" : "Disabled"})` : "No challenge selected"} className="bg-neutral-700 border-neutral-600 md:col-span-2" />
          </div>
          <div className="overflow-x-auto rounded border border-neutral-700">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-neutral-700 text-gray-300"><th className="py-2 px-2 text-left">Rank</th><th className="py-2 px-2 text-left">Trader</th><th className="py-2 px-2 text-right">PnL%</th><th className="py-2 px-2 text-right">Me</th></tr></thead>
              <tbody>
                {(leaderboardQuery.data?.rows ?? []).map((row: AnyRow) => (
                  <tr key={`${row.rank}-${row.userId}`} className={`border-b border-neutral-800/90 ${row.isYou ? "bg-neutral-700/30" : ""}`}>
                    <td className="py-2 px-2">#{toInt(row.rank, 0)}</td>
                    <td className="py-2 px-2">{row.displayName || `Trader #${row.userId}`}</td>
                    <td className="py-2 px-2 text-right">{formatPct(row.pnlPct)}</td>
                    <td className="py-2 px-2 text-right">{row.isYou ? "YES" : ""}</td>
                  </tr>
                ))}
                {!leaderboardQuery.isLoading && (leaderboardQuery.data?.rows?.length ?? 0) === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-gray-400">No leaderboard rows available.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="rewards" className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select value={selectedChallengeId ?? ""} onChange={(e) => setSelectedChallengeId(toInt(e.target.value, 0) || null)} className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm">
              {challenges.map((row) => <option key={row.id} value={row.id}>#{row.id} {row.name}</option>)}
            </select>
            <Input readOnly value={progressionQuery.data?.progression?.currentTier ? `Tier: ${progressionQuery.data.progression.currentTier}` : "No progression tier yet"} className="bg-neutral-700 border-neutral-600 md:col-span-2" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="bg-neutral-900/50 border-neutral-700"><CardHeader className="pb-2"><CardTitle className="text-sm">Badges</CardTitle></CardHeader><CardContent className="space-y-1 text-xs max-h-56 overflow-auto">{badges.map((badge) => <div key={badge.id} className="rounded border border-neutral-700 p-2 flex items-center justify-between"><span>{badge.iconEmoji || "🏅"} {badge.name}</span><span className="text-gray-500">{formatWhen(badge.awardedAt)}</span></div>)}{!badgesQuery.isLoading && badges.length === 0 ? <div className="text-gray-500">No badges awarded yet.</div> : null}</CardContent></Card>
            <Card className="bg-neutral-900/50 border-neutral-700"><CardHeader className="pb-2"><CardTitle className="text-sm">Certificates</CardTitle></CardHeader><CardContent className="space-y-1 text-xs max-h-56 overflow-auto">{certificates.map((cert) => <div key={cert.id} className="rounded border border-neutral-700 p-2"><div className="flex justify-between"><span>{cert.challengeName || `Challenge #${cert.challengeId}`}</span><span className="text-gray-500">{formatWhen(cert.issuedAt)}</span></div><div className="text-gray-500">Template: {cert.templateName || "Default"}</div><div className="flex gap-2 mt-1">{cert.isDownloadable ? <a href={`/api/trader/challenges/certificate/${cert.id}/download`} className="text-blue-300 underline">Download</a> : <span className="text-gray-500">Download disabled</span>} {cert.isShareable ? <a href={`/api/public/trader/challenges/certificate/${cert.verificationCodeHmac}/verify`} target="_blank" rel="noreferrer" className="text-blue-300 underline">Verify Link</a> : <span className="text-gray-500">Share disabled</span>}</div></div>)}{!certsQuery.isLoading && certificates.length === 0 ? <div className="text-gray-500">No certificates issued yet.</div> : null}</CardContent></Card>
          </div>

          {rewardsByChallengeQuery.data ? (
            <Card className="bg-neutral-900/50 border-neutral-700">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Selected Challenge Rewards</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div>Enrollment ID: {toInt(rewardsByChallengeQuery.data.enrollmentId, 0) || "-"}</div>
                <div>Badges in challenge: {(rewardsByChallengeQuery.data.badges ?? []).length}</div>
                <div>Prizes in challenge: {(rewardsByChallengeQuery.data.prizes ?? []).length}</div>
                <div>Selection boosts: {(rewardsByChallengeQuery.data.boosts ?? []).length}</div>
                {rewardsByChallengeQuery.data.certificate ? (
                  <div className="rounded border border-neutral-700 p-2">
                    Certificate issued on {formatWhen(rewardsByChallengeQuery.data.certificate.issuedAt)}
                  </div>
                ) : (
                  <div className="text-gray-500">No certificate for this challenge yet.</div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
