import type { Request } from "express";
import { randomUUID } from "crypto";
import { sha256Hex } from "../services/crypto";
import { valkeyGetJson, valkeyIncrWithTtl, valkeySetJson } from "../services/valkey";
import { IDENTITY_HEADER_DEVICE_FP, IDENTITY_HEADER_DEVICE_INSTALL_ID } from "@shared/identity/headers";
import { leadingZeroBitsOfHex } from "@shared/security/botChallenge";
import type { BotChallengePayload, BotProofToken } from "@shared/security/botChallenge";

type ChallengeRecord = {
  id: string;
  serverNonce: string;
  difficulty: number; // leading zero bits required
  exp: number; // unix seconds
  ip: string;
  deviceFp?: string;
  deviceInstallId?: string;
};

const memChallenges = new Map<string, ChallengeRecord>();
const memUsedUntil = new Map<string, number>();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function getIp(req: Request): string {
  const xf = (req.headers["x-forwarded-for"] as string | undefined) ?? "";
  const ip = xf.split(",")[0]?.trim();
  return ip || req.ip || "0.0.0.0";
}

function getDeviceFp(req: Request) {
  return (req.headers[IDENTITY_HEADER_DEVICE_FP] as string | undefined) || undefined;
}

function getDeviceInstallId(req: Request) {
  return (req.headers[IDENTITY_HEADER_DEVICE_INSTALL_ID] as string | undefined) || undefined;
}

function b64urlDecodeUtf8(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(base64, "base64").toString("utf8");
}

export function b64urlEncodeUtf8(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

type BotChallengeOpts = { valkeyEnabled?: boolean };

function bool(v: unknown, fallback: boolean) {
  if (v === undefined || v === null) return fallback;
  return Boolean(v);
}

function memMarkUsed(id: string, ttlSec: number) {
  const exp = nowSec() + Math.max(1, Math.trunc(ttlSec));
  memUsedUntil.set(id, exp);
  setTimeout(() => memUsedUntil.delete(id), ttlSec * 1000).unref?.();
}

function memIsUsed(id: string): boolean {
  const exp = memUsedUntil.get(id);
  if (!exp) return false;
  if (nowSec() > exp) {
    memUsedUntil.delete(id);
    return false;
  }
  return true;
}

export async function issueBotChallenge(
  req: Request,
  difficulty: number,
  ttlSec: number,
  opts?: BotChallengeOpts
): Promise<BotChallengePayload> {
  const id = randomUUID();
  const serverNonce = randomUUID().replace(/-/g, "");
  const exp = nowSec() + ttlSec;

  const rec: ChallengeRecord = {
    id,
    serverNonce,
    difficulty,
    exp,
    ip: getIp(req),
    deviceFp: getDeviceFp(req),
    deviceInstallId: getDeviceInstallId(req),
  };

  const useValkey = bool(opts?.valkeyEnabled, true);
  const stored = useValkey ? await valkeySetJson(`bot:ch:${id}`, rec, ttlSec) : false;

  if (!stored) {
    memChallenges.set(id, rec);
    setTimeout(() => memChallenges.delete(id), ttlSec * 1000).unref?.();
  }

  return { id, serverNonce, difficulty, expiresAt: exp };
}

async function loadChallenge(id: string, opts?: BotChallengeOpts): Promise<ChallengeRecord | null> {
  const useValkey = bool(opts?.valkeyEnabled, true);
  if (useValkey) {
    const fromValkey = await valkeyGetJson<ChallengeRecord>(`bot:ch:${id}`);
    if (fromValkey) return fromValkey;
  }
  return memChallenges.get(id) ?? null;
}

export async function verifyBotProof(
  req: Request,
  tokenB64Url: string,
  opts?: BotChallengeOpts
): Promise<{ ok: boolean; reason?: string }> {
  let tok: BotProofToken;
  try {
    tok = JSON.parse(b64urlDecodeUtf8(tokenB64Url)) as BotProofToken;
  } catch {
    return { ok: false, reason: "MALFORMED_TOKEN" };
  }

  const ch = await loadChallenge(tok.id, opts);
  if (!ch) return { ok: false, reason: "NO_CHALLENGE" };
  if (nowSec() > ch.exp) return { ok: false, reason: "EXPIRED" };
  if (memIsUsed(ch.id)) return { ok: false, reason: "REPLAY" };

  const ip = getIp(req);
  if (ip !== ch.ip) return { ok: false, reason: "IP_MISMATCH" };

  const fp = getDeviceFp(req);
  const install = getDeviceInstallId(req);
  if (ch.deviceFp && ch.deviceFp !== fp) return { ok: false, reason: "FP_MISMATCH" };
  if (ch.deviceInstallId && ch.deviceInstallId !== install) return { ok: false, reason: "INSTALL_MISMATCH" };

  const material = [ch.id, ch.serverNonce, String(tok.solutionNonce), fp || "", install || ""].join("|");
  const digest = sha256Hex(material);
  if (digest !== tok.digest) return { ok: false, reason: "DIGEST_MISMATCH" };

  const z = leadingZeroBitsOfHex(digest);
  if (z < ch.difficulty) return { ok: false, reason: "INSUFFICIENT_WORK" };

  const useValkey = bool(opts?.valkeyEnabled, true);
  if (useValkey) {
    const usedCount = await valkeyIncrWithTtl(`bot:ch:used:${ch.id}`, 600);
    if (usedCount != null && usedCount > 1) return { ok: false, reason: "REPLAY" };
  }

  memChallenges.delete(ch.id);
  memMarkUsed(ch.id, 600);

  return { ok: true };
}
