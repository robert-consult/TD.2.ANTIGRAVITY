import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

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

function formatSignedPct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const pct = (n * 100).toFixed(1);
  return `${n > 0 ? "+" : ""}${pct}%`;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
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

function extractErrorMessage(error: unknown): string | null {
  const responseData = (error as any)?.response?.data;
  if (typeof responseData?.message === "string" && responseData.message.trim().length > 0) {
    return responseData.message;
  }
  if (typeof responseData?.error === "string" && responseData.error.trim().length > 0) {
    return responseData.error;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return null;
}

export default function ChallengesCompetePanel({ competeEnabled }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState("browse");
  const [selectedChallengeId, setSelectedChallengeId] = useState<number | null>(null);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const challengesQuery = useQuery<any>({
    queryKey: ["/api/trader/challenges"],
    queryFn: () => axios.get("/api/trader/challenges").then((r) => r.data),
    enabled: competeEnabled,
    refetchInterval: 30000,
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
    enabled: competeEnabled && detailsOpen && selectedChallengeId != null,
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

  const challenges = (challengesQuery.data?.rows ?? []) as AnyRow[];
  const myEnrollments = (enrollmentsQuery.data?.rows ?? []) as AnyRow[];
  const badges = (badgesQuery.data?.rows ?? []) as AnyRow[];
  const certificates = (certsQuery.data?.rows ?? []) as AnyRow[];
  const challengeById = useMemo(() => new Map(challenges.map((row) => [toInt(row.id, 0), row])), [challenges]);

  const enrollMutation = useMutation({
    mutationFn: (challengeId: number) => axios.post(`/api/trader/challenges/${challengeId}/enroll`).then((r) => r.data),
    onMutate: (challengeId: number) => {
      const challengeName = challengeById.get(challengeId)?.name || `Challenge #${challengeId}`;
      toast({
        title: "Enrollment in progress",
        description: `Submitting enrollment for ${challengeName}.`,
      });
      return { challengeName };
    },
    onSuccess: (_data, challengeId: number, context) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges/my-enrollments"] });
      const challengeName = context?.challengeName || challengeById.get(challengeId)?.name || `Challenge #${challengeId}`;
      toast({
        title: "Enrollment successful",
        description: `You are now enrolled in ${challengeName}.`,
      });
    },
    onError: (error: unknown, challengeId: number, context) => {
      const challengeName = context?.challengeName || challengeById.get(challengeId)?.name || `Challenge #${challengeId}`;
      toast({
        title: "Enrollment failed",
        description: extractErrorMessage(error) || `Could not enroll in ${challengeName}.`,
        variant: "destructive",
      });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: (challengeId: number) => axios.post(`/api/trader/challenges/${challengeId}/withdraw`).then((r) => r.data),
    onMutate: (challengeId: number) => {
      const challengeName = challengeById.get(challengeId)?.name || `Challenge #${challengeId}`;
      toast({
        title: "Withdrawal in progress",
        description: `Submitting withdrawal for ${challengeName}.`,
      });
      return { challengeName };
    },
    onSuccess: (_data, challengeId: number, context) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges/my-enrollments"] });
      if (selectedEnrollmentId) {
        queryClient.invalidateQueries({ queryKey: ["/api/trader/challenges/enrollment/detail", selectedEnrollmentId] });
      }
      const challengeName = context?.challengeName || challengeById.get(challengeId)?.name || `Challenge #${challengeId}`;
      toast({
        title: "Withdrawal successful",
        description: `You have withdrawn from ${challengeName}.`,
      });
    },
    onError: (error: unknown, challengeId: number, context) => {
      const challengeName = context?.challengeName || challengeById.get(challengeId)?.name || `Challenge #${challengeId}`;
      toast({
        title: "Withdrawal failed",
        description: extractErrorMessage(error) || `Could not withdraw from ${challengeName}.`,
        variant: "destructive",
      });
    },
  });

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

  if (!competeEnabled) {
    return <div className="text-sm text-gray-400">Challenges are disabled by admin.</div>;
  }

  const selectedChallenge = selectedChallengeId ? challengeById.get(selectedChallengeId) : null;
  const challengeNowSec = toInt(challengesQuery.data?.now, Math.trunc(Date.now() / 1000));
  const selectedEnrollment = enrollmentDetailQuery.data?.enrollment as AnyRow | undefined;
  const selectedEnrollmentChallenge = enrollmentDetailQuery.data?.challenge as AnyRow | undefined;
  const selectedEnrollmentPhase = enrollmentDetailQuery.data?.phase as AnyRow | undefined;
  const selectedEnrollmentEvents = (enrollmentEventsQuery.data?.events ?? []) as AnyRow[];
  const selectedEnrollmentTrades = (enrollmentTradesQuery.data?.trades ?? []) as AnyRow[];
  const detailChallenge = challengeDetailQuery.data?.challenge as AnyRow | undefined;
  const detailPhases = (challengeDetailQuery.data?.phases ?? []) as AnyRow[];
  const detailEnrollment = challengeDetailQuery.data?.enrollment as AnyRow | null | undefined;
  const selectedChallengeValue = selectedChallengeId != null ? String(selectedChallengeId) : undefined;

  function openChallengeDetails(challengeId: number) {
    if (!Number.isInteger(challengeId) || challengeId <= 0) return;
    setSelectedChallengeId(challengeId);
    setDetailsOpen(true);
  }

  return (
    <div className="space-y-3" data-testid="trader-compete-panel">
      <Tabs value={view} onValueChange={setView} className="space-y-3">
        <TabsList className="tq-leaderboard-tabs bg-neutral-700 w-full h-auto p-1 grid grid-cols-2 md:grid-cols-4 gap-1 items-stretch">
          <TabsTrigger value="browse" className="tq-leaderboard-tab data-[state=active]:bg-neutral-600 text-[clamp(0.72rem,2.2vw,1rem)] px-1.5 py-1.5 min-h-[2.35rem] whitespace-normal break-words leading-tight text-center">BROWSE</TabsTrigger>
          <TabsTrigger value="my" className="tq-leaderboard-tab data-[state=active]:bg-neutral-600 text-[clamp(0.72rem,2.2vw,1rem)] px-1.5 py-1.5 min-h-[2.35rem] whitespace-normal break-words leading-tight text-center">MY CHALLENGES</TabsTrigger>
          <TabsTrigger value="leaderboard" className="tq-leaderboard-tab data-[state=active]:bg-neutral-600 text-[clamp(0.72rem,2.2vw,1rem)] px-1.5 py-1.5 min-h-[2.35rem] whitespace-normal break-words leading-tight text-center">LEADERBOARD</TabsTrigger>
          <TabsTrigger value="rewards" className="tq-leaderboard-tab data-[state=active]:bg-neutral-600 text-[clamp(0.72rem,2.2vw,1rem)] px-1.5 py-1.5 min-h-[2.35rem] whitespace-normal break-words leading-tight text-center">REWARDS</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-3">
          <div className="text-[clamp(0.72rem,2.2vw,1rem)] font-semibold uppercase tracking-[0.08em] text-slate-300">AVAILABLE CHALLENGES</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {challenges.map((row) => {
              const challengeId = toInt(row.id, 0);
              const enrollmentId = toInt(row.enrollment_id, 0);
              const statusTextRaw = String(row.enrollment_status || "NOT_ENROLLED").toUpperCase();
              const statusText = statusTextRaw.replaceAll("_", " ");
              const isActive = statusTextRaw === "ACTIVE";
              const targetPct = toNum(row.profit_target_pct, 0);
              const pnlPct = toNum(row.current_pnl_pct, 0);
              const progressToTarget = targetPct > 0 ? clampPct((pnlPct / targetPct) * 100) : 0;
              const enrolledAt = toInt(row.enrolled_at, 0);
              const durationDays = Math.max(0, toInt(row.duration_days, 0));
              const endsAt = enrolledAt > 0 && durationDays > 0 ? enrolledAt + durationDays * 86400 : 0;
              const timeLeftDays =
                endsAt > 0 ? Math.max(0, Math.ceil((endsAt - challengeNowSec) / 86400)) : durationDays;
              const pnlToneClass = pnlPct > 0 ? "text-emerald-400" : pnlPct < 0 ? "text-red-400" : "text-white";

              return (
                <Card key={row.id} className="bg-neutral-900/60 border-neutral-700/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-[clamp(0.9rem,3.1vw,1rem)] font-semibold tracking-tight leading-tight flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 break-words pr-2">{row.name}</span>
                      <span
                        className={`shrink-0 rounded-md px-3 py-1 text-[clamp(0.62rem,1.9vw,0.84rem)] font-semibold uppercase tracking-[0.12em] ${
                          isActive
                            ? "border border-cyan-400/70 text-cyan-300 bg-cyan-500/10 shadow-[0_0_14px_rgba(34,211,238,0.2)]"
                            : "border border-slate-600/70 text-slate-300 bg-slate-700/40"
                        }`}
                      >
                        {isActive ? "ACTIVE" : statusText}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-700/80 bg-neutral-950/70 p-3">
                        <div className="text-[clamp(0.68rem,2.2vw,0.84rem)] tracking-wide uppercase text-slate-400">TARGET</div>
                        <div className="mt-1 font-semibold text-[clamp(0.9rem,3.5vw,1rem)] leading-tight break-words text-emerald-400">{formatPct(row.profit_target_pct)}</div>
                      </div>
                      <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-700/80 bg-neutral-950/70 p-3">
                        <div className="text-[clamp(0.68rem,2.2vw,0.84rem)] tracking-wide uppercase text-slate-400">DAILY LOSS</div>
                        <div className="mt-1 font-semibold text-[clamp(0.9rem,3.5vw,1rem)] leading-tight break-words text-white">{formatPct(row.max_daily_loss_pct)}</div>
                      </div>
                      {isActive ? (
                        <>
                          <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-700/80 bg-neutral-950/70 p-3">
                            <div className="text-[clamp(0.68rem,2.2vw,0.84rem)] tracking-wide uppercase text-slate-400">PNL</div>
                            <div className={`mt-1 font-semibold text-[clamp(0.9rem,3.5vw,1rem)] leading-tight break-words ${pnlToneClass}`}>{formatSignedPct(pnlPct)}</div>
                          </div>
                          <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-700/80 bg-neutral-950/70 p-3">
                            <div className="text-[clamp(0.68rem,2.2vw,0.84rem)] tracking-wide uppercase text-slate-400">TIME LEFT</div>
                            <div className="mt-1 font-semibold text-[clamp(0.9rem,3.5vw,1rem)] leading-tight break-words text-white">{timeLeftDays}d</div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-700/80 bg-neutral-950/70 p-3">
                            <div className="text-[clamp(0.68rem,2.2vw,0.84rem)] tracking-wide uppercase text-slate-400">DURATION</div>
                            <div className="mt-1 font-semibold text-[clamp(0.9rem,3.5vw,1rem)] leading-tight break-words text-white">{durationDays}d</div>
                          </div>
                          <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-700/80 bg-neutral-950/70 p-3">
                            <div className="text-[clamp(0.68rem,2.2vw,0.84rem)] tracking-wide uppercase text-slate-400">FEE</div>
                            <div className="mt-1 font-semibold text-[clamp(0.9rem,3.5vw,1rem)] leading-tight break-words text-white">Free</div>
                          </div>
                        </>
                      )}
                    </div>

                    {isActive ? (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-[clamp(0.68rem,2.2vw,0.9rem)] tracking-wide uppercase text-slate-300">
                          <span>PROGRESS TO TARGET</span>
                          <span>{Math.round(progressToTarget)}%</span>
                        </div>
                        <div className="h-3 rounded-full border border-cyan-900/45 bg-black/70 overflow-hidden">
                          <div
                            className="h-full transition-[width] duration-500 ease-out"
                            style={{
                              width: `${progressToTarget}%`,
                              background:
                                "linear-gradient(90deg, rgba(34,211,238,0.95) 0%, rgba(56,189,248,0.95) 45%, rgba(124,58,237,0.95) 100%)",
                              boxShadow: "0 0 14px rgba(34,211,238,0.34)",
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="pt-1" />
                    )}

                    {isActive ? (
                      <Button
                        className="w-full h-auto min-h-[3rem] sm:min-h-[3.5rem] px-3 py-2 text-[clamp(0.78rem,2.7vw,1rem)] whitespace-normal break-words leading-tight font-semibold uppercase tracking-[0.12em] bg-cyan-400 hover:bg-cyan-300 text-black"
                        disabled={challengeId <= 0}
                        onClick={() => {
                          if (enrollmentId > 0) {
                            setSelectedEnrollmentId(enrollmentId);
                            setView("my");
                            return;
                          }
                          openChallengeDetails(challengeId);
                        }}
                      >
                        ENTER TRADING FLOOR
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full h-auto min-h-[3rem] sm:min-h-[3.5rem] px-3 py-2 text-[clamp(0.78rem,2.7vw,1rem)] whitespace-normal break-words leading-tight font-semibold uppercase tracking-[0.12em] border-cyan-400/85 text-cyan-300 hover:bg-cyan-500/10"
                        disabled={enrollMutation.isPending || challengeId <= 0}
                        onClick={() => enrollMutation.mutate(challengeId)}
                      >
                        ENROLL NOW
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {!challengesQuery.isLoading && challenges.length === 0 ? (
              <Card className="bg-neutral-900/50 border-neutral-700"><CardContent className="pt-6 text-sm text-gray-400">No challenges currently available.</CardContent></Card>
            ) : null}
          </div>
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
            <Select
              value={selectedChallengeValue}
              onValueChange={(value) => setSelectedChallengeId(toInt(value, 0) || null)}
              disabled={challenges.length === 0}
            >
              <SelectTrigger className="tq-compete-select-trigger bg-neutral-700 border-neutral-600 text-sm">
                <SelectValue placeholder={challenges.length > 0 ? "Select challenge" : "No challenge available"} />
              </SelectTrigger>
              <SelectContent className="tq-compete-select-content max-h-[280px]">
                {challenges.map((row) => (
                  <SelectItem key={row.id} value={String(row.id)} className="tq-compete-select-item">
                    #{row.id} {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              readOnly
              value={selectedChallenge ? `${selectedChallenge.name} (${selectedChallenge.leaderboard_enabled ? "Enabled" : "Disabled"})` : "No challenge selected"}
              className="tq-compete-readout bg-neutral-700 border-neutral-600 md:col-span-2"
            />
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
            <Select
              value={selectedChallengeValue}
              onValueChange={(value) => setSelectedChallengeId(toInt(value, 0) || null)}
              disabled={challenges.length === 0}
            >
              <SelectTrigger className="tq-compete-select-trigger bg-neutral-700 border-neutral-600 text-sm">
                <SelectValue placeholder={challenges.length > 0 ? "Select challenge" : "No challenge available"} />
              </SelectTrigger>
              <SelectContent className="tq-compete-select-content max-h-[280px]">
                {challenges.map((row) => (
                  <SelectItem key={row.id} value={String(row.id)} className="tq-compete-select-item">
                    #{row.id} {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              readOnly
              value={progressionQuery.data?.progression?.currentTier ? `Tier: ${progressionQuery.data.progression.currentTier}` : "No progression tier yet"}
              className="tq-compete-readout bg-neutral-700 border-neutral-600 md:col-span-2"
            />
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

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="tq-popup-panel tq-compete-dialog max-w-2xl bg-neutral-900 border-neutral-700 text-gray-100">
          <DialogHeader>
            <DialogTitle className="text-base">
              {detailChallenge?.name || "Challenge details"}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-400">
              {detailChallenge?.description || "Review challenge goals and phase rules before enrolling."}
            </DialogDescription>
          </DialogHeader>

          {challengeDetailQuery.isLoading ? (
            <div className="rounded border border-neutral-700 p-3 text-sm text-gray-400">Loading challenge details...</div>
          ) : null}

          {challengeDetailQuery.isError ? (
            <div className="rounded border border-red-900/70 bg-red-950/40 p-3 text-sm text-red-200 space-y-2">
              <div>{extractErrorMessage(challengeDetailQuery.error) || "Failed to load challenge details."}</div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-700 text-red-100"
                  onClick={() => {
                    challengeDetailQuery.refetch();
                  }}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : null}

          {!challengeDetailQuery.isLoading && !challengeDetailQuery.isError && detailChallenge ? (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="rounded border border-neutral-700 p-2">
                  Status:{" "}
                  <Badge variant={statusVariant(detailEnrollment?.status || "NOT_ENROLLED")}>
                    {String(detailEnrollment?.status || "NOT_ENROLLED")}
                  </Badge>
                </div>
                <div className="rounded border border-neutral-700 p-2">
                  Enrollment Window:{" "}
                  {formatWhen(detailChallenge.enrollmentStartAt ?? detailChallenge.enrollment_start_at)} to{" "}
                  {formatWhen(detailChallenge.enrollmentEndAt ?? detailChallenge.enrollment_end_at)}
                </div>
                <div className="rounded border border-neutral-700 p-2">
                  Target: {formatPct(detailChallenge.profitTargetPct ?? detailChallenge.profit_target_pct)}
                </div>
                <div className="rounded border border-neutral-700 p-2">
                  Daily Loss: {formatPct(detailChallenge.maxDailyLossPct ?? detailChallenge.max_daily_loss_pct)}
                </div>
                <div className="rounded border border-neutral-700 p-2">
                  Total Loss: {formatPct(detailChallenge.maxTotalLossPct ?? detailChallenge.max_total_loss_pct)}
                </div>
                <div className="rounded border border-neutral-700 p-2">
                  Duration: {toInt(detailChallenge.durationDays ?? detailChallenge.duration_days, 0)}d
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-gray-300 font-medium">Phases</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {detailPhases.map((phase) => (
                    <div key={phase.id} className="rounded border border-neutral-700 p-2">
                      <div className="font-semibold">{phase.phaseName || `Phase ${phase.phaseNumber}`}</div>
                      <div>Target: {formatPct(phase.profitTargetPct)}</div>
                      <div>Daily: {formatPct(phase.maxDailyLossPct)}</div>
                      <div>Total: {formatPct(phase.maxTotalLossPct)}</div>
                      <div>Duration: {toInt(phase.durationDays, 0)}d</div>
                      <div>Min Days: {toInt(phase.minTradingDays, 0)}</div>
                    </div>
                  ))}
                  {detailPhases.length === 0 ? <div className="text-gray-500">No phase details configured.</div> : null}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
