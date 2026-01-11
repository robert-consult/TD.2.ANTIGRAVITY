import express from "express";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import Database from "better-sqlite3";
import { appendIdentityAudit } from "../services/identityAudit";
import { sha256Hex, randomToken, encryptString, decryptString } from "../services/crypto";
import { storage } from "../storage";

export const profileMfaRouter = express.Router();

function getDb() {
  return new Database("./trading_app.db");
}

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
  
  const db = getDb();
  try {
    const row = db.prepare(`SELECT * FROM user_mfa WHERE user_id = ? LIMIT 1`).get(userId) as any;
    
    return res.json({
      enabled: !!row?.enabled_at,
      enabledAt: row?.enabled_at ? new Date(row.enabled_at * 1000).toISOString() : null,
      hasRecoveryCodes: !!row?.recovery_codes_hash_json,
      hasPendingSetup: !!row?.totp_pending_secret_enc && !row?.enabled_at,
    });
  } finally {
    db.close();
  }
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
  
  const db = getDb();
  try {
    const existing = db.prepare(`SELECT 1 FROM user_mfa WHERE user_id = ? LIMIT 1`).get(userId) as any;
    
    if (!existing) {
      db.prepare(`
        INSERT INTO user_mfa (user_id, totp_pending_secret_enc, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, enc, nowSec, nowSec);
    } else {
      db.prepare(`
        UPDATE user_mfa SET totp_pending_secret_enc = ?, updated_at = ? WHERE user_id = ?
      `).run(enc, nowSec, userId);
    }
  } finally {
    db.close();
  }
  
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
  
  const db = getDb();
  try {
    const row = db.prepare(`SELECT * FROM user_mfa WHERE user_id = ? LIMIT 1`).get(userId) as any;
    const pending = row?.totp_pending_secret_enc;
    
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
    
    db.prepare(`
      UPDATE user_mfa SET 
        totp_secret_enc = ?,
        totp_pending_secret_enc = NULL,
        enabled_at = ?,
        disabled_at = NULL,
        recovery_codes_hash_json = ?,
        recovery_codes_used_json = ?,
        updated_at = ?
      WHERE user_id = ?
    `).run(pending, nowSec, JSON.stringify(recoveryHashes), JSON.stringify([]), nowSec, userId);
    
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
  } finally {
    db.close();
  }
});

profileMfaRouter.post("/api/profile/mfa/verify", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  const { code } = req.body ?? {};
  const c = String(code ?? "").trim();
  
  const db = getDb();
  try {
    const row = db.prepare(`SELECT * FROM user_mfa WHERE user_id = ? LIMIT 1`).get(userId) as any;
    
    if (!row?.totp_secret_enc || !row?.enabled_at) {
      return res.status(400).json({ ok: false, message: "MFA is not enabled." });
    }
    
    const secretBase32 = decryptString(row.totp_secret_enc);
    const isValid = speakeasy.totp.verify({
      secret: secretBase32,
      encoding: "base32",
      token: c,
      window: 1,
    });
    
    if (!isValid) {
      const failedAttempts = (row.failed_attempts ?? 0) + 1;
      const nowSec = Math.floor(Date.now() / 1000);
      db.prepare(`UPDATE user_mfa SET failed_attempts = ?, updated_at = ? WHERE user_id = ?`).run(failedAttempts, nowSec, userId);
      return res.status(400).json({ ok: false, message: "Invalid verification code." });
    }
    
    const nowSec = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE user_mfa SET last_verified_at = ?, failed_attempts = 0, updated_at = ? WHERE user_id = ?`).run(nowSec, nowSec, userId);
    
    return res.json({ ok: true, message: "Code verified successfully." });
  } finally {
    db.close();
  }
});

profileMfaRouter.post("/api/profile/mfa/disable", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  const { code } = req.body ?? {};
  const c = String(code ?? "").trim();
  
  const user = await storage.getUserById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  
  const db = getDb();
  try {
    const row = db.prepare(`SELECT * FROM user_mfa WHERE user_id = ? LIMIT 1`).get(userId) as any;
    
    if (!row?.totp_secret_enc || !row?.enabled_at) {
      return res.status(400).json({ ok: false, message: "MFA is not enabled." });
    }
    
    const secretBase32 = decryptString(row.totp_secret_enc);
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
    db.prepare(`
      UPDATE user_mfa SET 
        totp_secret_enc = NULL,
        totp_pending_secret_enc = NULL,
        enabled_at = NULL,
        disabled_at = ?,
        recovery_codes_hash_json = NULL,
        recovery_codes_used_json = NULL,
        updated_at = ?
      WHERE user_id = ?
    `).run(nowSec, nowSec, userId);
    
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
  } finally {
    db.close();
  }
});

profileMfaRouter.post("/api/profile/mfa/use-recovery", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  const userId = req.session.userId;
  const { code } = req.body ?? {};
  const c = String(code ?? "").trim().toUpperCase();
  
  const user = await storage.getUserById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  
  const db = getDb();
  try {
    const row = db.prepare(`SELECT * FROM user_mfa WHERE user_id = ? LIMIT 1`).get(userId) as any;
    
    if (!row?.enabled_at || !row?.recovery_codes_hash_json) {
      return res.status(400).json({ ok: false, message: "MFA is not enabled or no recovery codes." });
    }
    
    const hashes: string[] = JSON.parse(row.recovery_codes_hash_json);
    const usedIndices: number[] = JSON.parse(row.recovery_codes_used_json ?? "[]");
    const codeHash = sha256Hex(c);
    
    const idx = hashes.findIndex((h, i) => h === codeHash && !usedIndices.includes(i));
    if (idx === -1) {
      return res.status(400).json({ ok: false, message: "Invalid or already used recovery code." });
    }
    
    usedIndices.push(idx);
    const nowSec = Math.floor(Date.now() / 1000);
    
    db.prepare(`
      UPDATE user_mfa SET 
        recovery_codes_used_json = ?,
        last_verified_at = ?,
        updated_at = ?
      WHERE user_id = ?
    `).run(JSON.stringify(usedIndices), nowSec, nowSec, userId);
    
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
  } finally {
    db.close();
  }
});
