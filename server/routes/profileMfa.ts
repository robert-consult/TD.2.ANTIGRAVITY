import express from "express";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { db } from "@db";
import { userMfa } from "@shared/schema";
import { eq } from "drizzle-orm";
import { appendIdentityAudit } from "../services/identityAudit";
import { sha256Hex, randomToken, encryptString, decryptString } from "../services/crypto";
import { storage } from "../storage";

export const profileMfaRouter = express.Router();

function generateRecoveryCodes(n = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    codes.push(randomToken(5).toUpperCase().slice(0, 10));
  }
  return codes;
}

profileMfaRouter.get("/api/profile/mfa/status", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  
  const row = await db.query.userMfa.findFirst({
    where: eq(userMfa.userId, userId),
  });

  return res.json({
    enabled: !!row?.enabledAt,
    enabledAt: row?.enabledAt ? new Date(row.enabledAt * 1000).toISOString() : null,
    hasRecoveryCodes: !!row?.recoveryCodesHashJson,
    hasPendingSetup: !!row?.totpPendingSecretEnc && !row?.enabledAt,
  });
});

profileMfaRouter.post("/api/profile/mfa/setup", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  const email = req.session.email || "user@tradequip.com";
  
  const user = await storage.getUserById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  
  const secret = speakeasy.generateSecret({
    name: `TradeQuip (${user.email})`,
    length: 20,
  });
  
  const otpauthUrl = secret.otpauth_url!;
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  
  const enc = encryptString(secret.base32);
  const nowSec = Math.floor(Date.now() / 1000);
  
  await db.insert(userMfa)
    .values({
      userId,
      totpPendingSecretEnc: enc,
      createdAt: nowSec,
      updatedAt: nowSec,
    })
    .onConflictDoUpdate({
      target: userMfa.userId,
      set: {
        totpPendingSecretEnc: enc,
        updatedAt: nowSec,
      },
    });
  
  appendIdentityAudit({
    userId: userId,
    email: user.email,
    username: user.username,
    category: "MFA",
    type: "MFA_SETUP_STARTED",
    title: "MFA setup started",
    ip: (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined,
    userAgent: req.headers["user-agent"] ?? undefined,
  });
  
  return res.json({ otpauthUrl, qrCodeDataUrl });
});

profileMfaRouter.post("/api/profile/mfa/enable", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  const { code } = req.body ?? {};
  const c = String(code ?? "").trim();
  
  const user = await storage.getUserById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  
  const row = await db.query.userMfa.findFirst({
    where: eq(userMfa.userId, userId),
  });
  const pending = row?.totpPendingSecretEnc;

  if (!pending) {
    return res.status(400).json({ ok: false, message: "No pending MFA setup. Please start setup first." });
  }

  const secretBase32 = decryptString(pending);
  const isValid = speakeasy.totp.verify({
    secret: secretBase32,
    encoding: "base32",
    token: c,
    window: 1,
  });

  if (!isValid) {
    return res.status(400).json({ ok: false, message: "Invalid verification code. Please try again." });
  }

  const recoveryCodes = generateRecoveryCodes(10);
  const recoveryHashes = recoveryCodes.map((x) => sha256Hex(x));
  const nowSec = Math.floor(Date.now() / 1000);

  await db.update(userMfa)
    .set({
      totpSecretEnc: pending,
      totpPendingSecretEnc: null,
      enabledAt: nowSec,
      disabledAt: null,
      recoveryCodesHashJson: JSON.stringify(recoveryHashes),
      recoveryCodesUsedJson: JSON.stringify([]),
      updatedAt: nowSec,
    })
    .where(eq(userMfa.userId, userId));

  appendIdentityAudit({
    userId: userId,
    email: user.email,
    username: user.username,
    category: "MFA",
    type: "MFA_ENABLED",
    title: "MFA enabled",
    ip: (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined,
    userAgent: req.headers["user-agent"] ?? undefined,
  });

  return res.json({
    ok: true,
    recoveryCodes,
    message: "Two-factor authentication enabled successfully. Save your recovery codes!",
  });
});

profileMfaRouter.post("/api/profile/mfa/verify", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  const { code } = req.body ?? {};
  const c = String(code ?? "").trim();
  
  const row = await db.query.userMfa.findFirst({
    where: eq(userMfa.userId, userId),
  });

  if (!row?.totpSecretEnc || !row?.enabledAt) {
    return res.status(400).json({ ok: false, message: "MFA is not enabled." });
  }

  const secretBase32 = decryptString(row.totpSecretEnc);
  const isValid = speakeasy.totp.verify({
    secret: secretBase32,
    encoding: "base32",
    token: c,
    window: 1,
  });

  if (!isValid) {
    const failedAttempts = (row.failedAttempts ?? 0) + 1;
    const nowSec = Math.floor(Date.now() / 1000);
    await db.update(userMfa)
      .set({ failedAttempts, updatedAt: nowSec })
      .where(eq(userMfa.userId, userId));
    return res.status(400).json({ ok: false, message: "Invalid verification code." });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  await db.update(userMfa)
    .set({ lastVerifiedAt: nowSec, failedAttempts: 0, updatedAt: nowSec })
    .where(eq(userMfa.userId, userId));

  return res.json({ ok: true, message: "Code verified successfully." });
});

profileMfaRouter.post("/api/profile/mfa/disable", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  const { code } = req.body ?? {};
  const c = String(code ?? "").trim();
  
  const user = await storage.getUserById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  
  const row = await db.query.userMfa.findFirst({
    where: eq(userMfa.userId, userId),
  });

  if (!row?.totpSecretEnc || !row?.enabledAt) {
    return res.status(400).json({ ok: false, message: "MFA is not enabled." });
  }

  const secretBase32 = decryptString(row.totpSecretEnc);
  const isValid = speakeasy.totp.verify({
    secret: secretBase32,
    encoding: "base32",
    token: c,
    window: 1,
  });

  if (!isValid) {
    return res.status(400).json({ ok: false, message: "Invalid verification code. Cannot disable MFA." });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  await db.update(userMfa)
    .set({
      totpSecretEnc: null,
      totpPendingSecretEnc: null,
      enabledAt: null,
      disabledAt: nowSec,
      recoveryCodesHashJson: null,
      recoveryCodesUsedJson: null,
      updatedAt: nowSec,
    })
    .where(eq(userMfa.userId, userId));

  appendIdentityAudit({
    userId: userId,
    email: user.email,
    username: user.username,
    category: "MFA",
    type: "MFA_DISABLED",
    title: "MFA disabled",
    ip: (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined,
    userAgent: req.headers["user-agent"] ?? undefined,
  });

  return res.json({ ok: true, message: "Two-factor authentication disabled." });
});

profileMfaRouter.post("/api/profile/mfa/use-recovery", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  const { code } = req.body ?? {};
  const c = String(code ?? "").trim().toUpperCase();
  
  const user = await storage.getUserById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  
  const row = await db.query.userMfa.findFirst({
    where: eq(userMfa.userId, userId),
  });

  if (!row?.enabledAt || !row?.recoveryCodesHashJson) {
    return res.status(400).json({ ok: false, message: "MFA is not enabled or no recovery codes." });
  }

  const hashes: string[] = JSON.parse(row.recoveryCodesHashJson);
  const usedIndices: number[] = JSON.parse(row.recoveryCodesUsedJson ?? "[]");
  const codeHash = sha256Hex(c);

  const idx = hashes.findIndex((h, i) => h === codeHash && !usedIndices.includes(i));
  if (idx === -1) {
    return res.status(400).json({ ok: false, message: "Invalid or already used recovery code." });
  }

  usedIndices.push(idx);
  const nowSec = Math.floor(Date.now() / 1000);

  await db.update(userMfa)
    .set({
      recoveryCodesUsedJson: JSON.stringify(usedIndices),
      lastVerifiedAt: nowSec,
      updatedAt: nowSec,
    })
    .where(eq(userMfa.userId, userId));

  appendIdentityAudit({
    userId: userId,
    email: user.email,
    username: user.username,
    category: "MFA",
    type: "MFA_RECOVERY_CODE_USED",
    title: "Recovery code used",
    description: `Recovery code ${idx + 1} of ${hashes.length} used`,
    ip: (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined,
    userAgent: req.headers["user-agent"] ?? undefined,
  });

  const remaining = hashes.length - usedIndices.length;
  return res.json({
    ok: true,
    message: `Recovery code accepted. ${remaining} recovery codes remaining.`,
    remainingCodes: remaining,
  });
});
