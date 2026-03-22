import type { Request, Response } from "express";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { botRiskAssessments } from "@shared/schema";
import { issueBotChallenge, verifyBotProof } from "./botChallenge";
import { valkeyIncrWithTtl, valkeySAddWithTtl } from "../services/valkey";
import {
  IDENTITY_HEADER_BOT_PROOF,
  IDENTITY_HEADER_CLIENT_TZ,
  IDENTITY_HEADER_DEVICE_FP,
  IDENTITY_HEADER_DEVICE_INSTALL_ID,
} from "@shared/identity/headers";
import { BOT_CHALLENGE_REQUIRED_CODE } from "@shared/security/botChallenge";
import { incBotChallengesIssuedTotal } from "../routes/metricsState";
import { getBotGuardConfig } from "../services/runtimeConfig/botConfig";
import {
  labelFor,
  type BotGuardAction,
  type BotWindows,
  uaHeuristicsScore,
  windowPenalty,
} from "./botGuardHeuristics";

export type BotGuardProof = "OK" | "MISSING" | "INVALID" | "NOT_REQUIRED" | "SKIPPED";

export type BotGuardSignals = {
  action: BotGuardAction;
  ip: string;
  ua: string;
  deviceFpPresent: boolean;
  installIdPresent: boolean;
  tzPresent: boolean;
  windows?: {
    ip1m: number | null;
    ip10m: number | null;
    inst10m: number | null;
    fp10m: number | null;
  };
  proof: BotGuardProof;
  rawScore: number;
  ewmaPrev?: number;
  updatedAtIso: string;
};

export async function persistBotAssessmentForUser(args: {
  userId: number;
  score: number;
  signals: BotGuardSignals;
}): Promise<{ score: number; label: string }> {
  const userId = Number(args.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return { score: clamp(args.score, 0, 100), label: labelFor(clamp(args.score, 0, 100)) };
  }

  const observedScore = clamp(args.score, 0, 100);

  const prev = await db.query.botRiskAssessments.findFirst({
    where: eq(botRiskAssessments.userId, userId),
  });
  const prevScore = toInt((prev as any)?.score, 0);
  const newScore = Math.round(prevScore * 0.85 + observedScore * 0.15);
  const label = labelFor(newScore);

  const signals: BotGuardSignals = {
    ...args.signals,
    rawScore: observedScore,
    ewmaPrev: prevScore,
    updatedAtIso: new Date().toISOString(),
  };

  const nowSec = Math.floor(Date.now() / 1000);
  await db.insert(botRiskAssessments)
    .values({
      userId,
      score: newScore,
      label,
      signalsJson: JSON.stringify(signals),
      updatedAt: nowSec,
    })
    .onConflictDoUpdate({
      target: botRiskAssessments.userId,
      set: {
        score: newScore,
        label,
        signalsJson: JSON.stringify(signals),
        updatedAt: nowSec,
      } as any,
    });

  return { score: newScore, label };
}

function nowMs() {
  return Date.now();
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getIp(req: Request) {
  const xf = (req.headers["x-forwarded-for"] as string | undefined) ?? "";
  const ip = xf.split(",")[0]?.trim();
  return ip || req.ip || "0.0.0.0";
}

function getUa(req: Request) {
  return (req.headers["user-agent"] as string | undefined) ?? "";
}

function getDeviceFp(req: Request) {
  return (req.headers[IDENTITY_HEADER_DEVICE_FP] as string | undefined) ?? "";
}

function getInstallId(req: Request) {
  return (req.headers[IDENTITY_HEADER_DEVICE_INSTALL_ID] as string | undefined) ?? "";
}

function getClientTz(req: Request) {
  return (req.headers[IDENTITY_HEADER_CLIENT_TZ] as string | undefined) ?? "";
}

async function bumpWindows(
  cfg: Awaited<ReturnType<typeof getBotGuardConfig>>,
  req: Request,
  action: BotGuardAction,
  email?: string,
): Promise<BotWindows> {
  const windows: BotWindows = { ip1m: null, ip10m: null, inst10m: null, fp10m: null };
  if (!cfg.valkeyEnabled) return windows;

  const ip = getIp(req);
  const fp = getDeviceFp(req);
  const inst = getInstallId(req);

  windows.ip1m = await valkeyIncrWithTtl(`bot:w:ip:${ip}:${action}:1m`, 60);
  windows.ip10m = await valkeyIncrWithTtl(`bot:w:ip:${ip}:${action}:10m`, 600);

  if (inst) {
    windows.inst10m = await valkeyIncrWithTtl(`bot:w:inst:${inst}:${action}:10m`, 600);
  }
  if (fp) {
    windows.fp10m = await valkeyIncrWithTtl(`bot:w:fp:${fp}:${action}:10m`, 600);
  }

  if (email) {
    await valkeySAddWithTtl(`bot:w:ip:${ip}:emails:10m`, email.toLowerCase(), 600);
    if (inst) await valkeySAddWithTtl(`bot:w:inst:${inst}:emails:10m`, email.toLowerCase(), 600);
  }

  return windows;
}

export async function botGuard(
  req: Request,
  res: Response,
  opts: { action: BotGuardAction; email?: string; userId?: number }
): Promise<{ allowed: boolean; score: number; proof: BotGuardProof; signals: BotGuardSignals }> {
  const cfg = await getBotGuardConfig();

  const ua = getUa(req);
  const fp = getDeviceFp(req);
  const inst = getInstallId(req);
  const tz = getClientTz(req);

  const windows = await bumpWindows(cfg, req, opts.action, opts.email);

  let score = 0;
  score += uaHeuristicsScore(ua);
  if (!fp) score += 15;
  if (!inst) score += 10;
  if (!tz) score += 5;

  if (opts.action === "SIGNUP") score += 10;
  if (opts.action === "TRADE") score += 5;

  score += windowPenalty(opts.action, windows);

  const requiresProof =
    cfg.powEnabled &&
    ((opts.action === "SIGNUP" && cfg.powEnforceSignup && score >= cfg.powChallengeScore) ||
      (opts.action === "LOGIN" && cfg.powEnforceLogin && score >= cfg.powChallengeScore) ||
      (opts.action === "TRADE" && score >= cfg.tradePowChallengeScore));

  const proofHdr = (req.headers[IDENTITY_HEADER_BOT_PROOF] as string | undefined) ?? "";
  let proofResult: BotGuardProof = cfg.powEnabled ? "NOT_REQUIRED" : "SKIPPED";

  if (cfg.powEnabled && requiresProof) {
    if (!proofHdr) {
      proofResult = "MISSING";
    } else {
      const ver = await verifyBotProof(req, proofHdr, { valkeyEnabled: cfg.valkeyEnabled });
      proofResult = ver.ok ? "OK" : "INVALID";
      if (!ver.ok) score += 25;
      if (ver.ok) score = Math.max(0, score - 20);
    }
  }

  score = clamp(score, 0, 100);

  const signals: BotGuardSignals = {
    action: opts.action,
    ip: getIp(req),
    ua,
    deviceFpPresent: Boolean(fp),
    installIdPresent: Boolean(inst),
    tzPresent: Boolean(tz),
    windows,
    proof: proofResult,
    rawScore: score,
    updatedAtIso: new Date().toISOString(),
  };

  if (opts.userId) {
    const persisted = await persistBotAssessmentForUser({ userId: opts.userId, score, signals });
    score = persisted.score;
  }

  if (requiresProof && (proofResult === "MISSING" || proofResult === "INVALID")) {
    const difficulty = clamp(
      cfg.powBaseDifficulty + Math.floor(score / 30),
      cfg.powBaseDifficulty,
      cfg.powMaxDifficulty
    );
    const ch = await issueBotChallenge(req, difficulty, cfg.powTtlSec, { valkeyEnabled: cfg.valkeyEnabled });

    incBotChallengesIssuedTotal();

    res.status(428).json({
      code: BOT_CHALLENGE_REQUIRED_CODE,
      message: "Proof required before continuing.",
      challenge: ch,
    });

    return { allowed: false, score, proof: proofResult, signals };
  }

  return { allowed: true, score, proof: proofResult, signals };
}
