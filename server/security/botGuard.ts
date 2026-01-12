import type { Request, Response } from "express";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { botRiskAssessments, systemConfig } from "@shared/schema";
import { issueBotChallenge, verifyBotProof } from "./botChallenge";
import { valkeyIncrWithTtl, valkeySAddWithTtl } from "../services/valkey";

type BotConfig = {
  botScoreThreshold: number; // default 40
  powEnabled: boolean;
  powEnforceSignup: boolean;
  powEnforceLogin: boolean;
  powChallengeScore: number; // score >= this => require proof
  powBaseDifficulty: number;
  powMaxDifficulty: number;
  powTtlSec: number;
  valkeyEnabled: boolean;
};

type BotGuardAction = "LOGIN" | "SIGNUP" | "TRADE";

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

let cached: { at: number; cfg: BotConfig } | null = null;

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

async function getBotConfig(): Promise<BotConfig> {
  if (cached && nowMs() - cached.at < 15_000) return cached.cfg;

  const sc = await db.query.systemConfig.findFirst({ where: eq(systemConfig.id, 1) });
  const cfg: BotConfig = {
    botScoreThreshold: toInt((sc as any)?.botScoreThreshold, 40),
    powEnabled: Boolean((sc as any)?.botPowEnabled ?? true),
    powEnforceSignup: Boolean((sc as any)?.botPowEnforceSignup ?? true),
    powEnforceLogin: Boolean((sc as any)?.botPowEnforceLogin ?? false),
    powChallengeScore: toInt((sc as any)?.botPowChallengeScore, 25),
    powBaseDifficulty: toInt((sc as any)?.botPowBaseDifficulty, 14),
    powMaxDifficulty: toInt((sc as any)?.botPowMaxDifficulty, 20),
    powTtlSec: toInt((sc as any)?.botPowTtlSec, 120),
    valkeyEnabled: Boolean((sc as any)?.botValkeyEnabled ?? true),
  };

  cached = { at: nowMs(), cfg };
  return cfg;
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
  return (req.headers["x-device-fp"] as string | undefined) ?? "";
}

function getInstallId(req: Request) {
  return (req.headers["x-device-install-id"] as string | undefined) ?? "";
}

function getClientTz(req: Request) {
  return (req.headers["x-client-tz"] as string | undefined) ?? "";
}

function uaHeuristicsScore(ua: string): number {
  const s = ua.toLowerCase();
  let pts = 0;
  if (!ua) pts += 10;
  if (s.includes("headless")) pts += 25;
  if (s.includes("phantomjs")) pts += 40;
  if (s.includes("selenium")) pts += 40;
  if (s.includes("playwright")) pts += 35;
  if (s.includes("puppeteer")) pts += 35;
  if (s.includes("curl/")) pts += 40;
  if (s.includes("python-requests")) pts += 40;
  return pts;
}

function labelFor(score: number) {
  if (score >= 60) return "HIGH";
  if (score >= 40) return "SUSPICIOUS";
  return "OK";
}

type BotWindows = {
  ip1m: number | null;
  ip10m: number | null;
  inst10m: number | null;
  fp10m: number | null;
};

function windowPenalty(action: BotGuardAction, w: BotWindows): number {
  const ip1m = w.ip1m ?? 0;
  const ip10m = w.ip10m ?? 0;
  const inst10m = w.inst10m ?? 0;
  const fp10m = w.fp10m ?? 0;

  let pts = 0;

  if (action === "SIGNUP") {
    if (ip1m >= 20) pts += 35;
    else if (ip1m >= 10) pts += 25;
    else if (ip1m >= 5) pts += 15;
    else if (ip1m >= 3) pts += 10;

    if (ip10m >= 80) pts += 25;
    else if (ip10m >= 40) pts += 15;
    else if (ip10m >= 20) pts += 10;

    if (inst10m >= 10) pts += 25;
    else if (inst10m >= 5) pts += 15;

    if (fp10m >= 20) pts += 15;
    else if (fp10m >= 10) pts += 10;
  } else if (action === "LOGIN") {
    if (ip1m >= 30) pts += 25;
    else if (ip1m >= 15) pts += 15;
    else if (ip1m >= 8) pts += 10;

    if (ip10m >= 200) pts += 25;
    else if (ip10m >= 100) pts += 15;
    else if (ip10m >= 50) pts += 10;

    if (inst10m >= 20) pts += 20;
    else if (inst10m >= 10) pts += 15;
    else if (inst10m >= 5) pts += 10;

    if (fp10m >= 40) pts += 15;
    else if (fp10m >= 20) pts += 10;
  } else if (action === "TRADE") {
    if (ip1m >= 60) pts += 25;
    else if (ip1m >= 30) pts += 15;

    if (ip10m >= 400) pts += 25;
    else if (ip10m >= 200) pts += 15;
    else if (ip10m >= 100) pts += 10;

    if (inst10m >= 40) pts += 20;
    else if (inst10m >= 20) pts += 15;
    else if (inst10m >= 10) pts += 10;

    if (fp10m >= 60) pts += 15;
    else if (fp10m >= 30) pts += 10;
  }

  return clamp(pts, 0, 60);
}

async function bumpWindows(cfg: BotConfig, req: Request, action: BotGuardAction, email?: string): Promise<BotWindows> {
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
  const cfg = await getBotConfig();

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
      (opts.action === "TRADE" && score >= cfg.powChallengeScore + 10));

  const proofHdr = (req.headers["x-bot-proof"] as string | undefined) ?? "";
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

    res.status(428).json({
      code: "BOT_CHALLENGE_REQUIRED",
      message: "Proof required before continuing.",
      challenge: ch,
    });

    return { allowed: false, score, proof: proofResult, signals };
  }

  return { allowed: true, score, proof: proofResult, signals };
}
