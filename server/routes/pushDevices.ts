import { Request, Router } from "express";
import { z } from "zod";
import {
  IDENTITY_HEADER_APP_VERSION,
  IDENTITY_HEADER_CLIENT_LANG,
  IDENTITY_HEADER_CLIENT_TZ,
  IDENTITY_HEADER_DEVICE_FP,
  IDENTITY_HEADER_DEVICE_ID,
  IDENTITY_HEADER_DEVICE_INSTALL_ID,
  readIdentityHeader,
} from "@shared/identity/headers";
import { requireAuth } from "../middleware/auth";
import { appendIdentityAudit } from "../services/identityAudit";
import {
  listPushDevicesForUser,
  revokeAllPushDevicesForUser,
  revokePushDeviceById,
  revokePushDeviceByToken,
  upsertPushDevice,
} from "../services/pushDevices";
import { getClientIp, getUserAgent } from "../security/sessionTrail";

const registerPushDeviceSchema = z.object({
  token: z.string().min(16).max(4096),
  appVariant: z.enum(["native", "wrapper"]).default("native"),
  platform: z.enum(["android", "ios", "web"]).optional(),
  environment: z.enum(["development", "staging", "production"]).default("production"),
  pushProvider: z.enum(["FCM", "APNS"]).optional(),
  deviceId: z.string().trim().min(1).max(256).optional(),
  deviceInstallId: z.string().trim().min(1).max(256).optional(),
  deviceFingerprint: z.string().trim().min(1).max(512).optional(),
  appVersion: z.string().trim().min(1).max(64).optional(),
  buildNumber: z.string().trim().min(1).max(64).optional(),
  locale: z.string().trim().min(1).max(64).optional(),
  timezone: z.string().trim().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const unregisterPushDeviceSchema = z.object({
  token: z.string().min(16).max(4096).optional(),
  all: z.boolean().optional(),
}).refine((data) => data.all === true || Boolean(data.token), {
  path: ["token"],
  message: "Either token or all=true is required",
});

function parsePositiveInt(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function resolvePlatform(inputPlatform: string | undefined, req: Request): "android" | "ios" | "web" {
    if (inputPlatform === "android" || inputPlatform === "ios" || inputPlatform === "web") {
        return inputPlatform;
    }

    const headerPlatform = String(readIdentityHeader(req.headers as Record<string, unknown>, "x-platform") ?? "")
        .trim()
        .toLowerCase();
    if (headerPlatform.includes("ios")) return "ios";
    if (headerPlatform === "web") return "web";
    return "android";
}

export const pushDevicesRouter = Router();
pushDevicesRouter.use(requireAuth);

pushDevicesRouter.get("/", async (req, res) => {
  const userId = Number(req.session.userId);

  try {
    const devices = await listPushDevicesForUser(userId);
    return res.json({ rows: devices });
  } catch (error) {
    console.error("[push] list failed", error);
    return res.status(500).json({ message: "Failed to fetch registered push devices" });
  }
});

pushDevicesRouter.post("/register", async (req, res) => {
  const userId = Number(req.session.userId);
  const parsed = registerPushDeviceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid push device payload",
      issues: parsed.error.flatten(),
    });
  }

  try {
    const device = await upsertPushDevice({
      userId,
      token: parsed.data.token,
      appVariant: parsed.data.appVariant,
      platform: resolvePlatform(parsed.data.platform, req),
      environment: parsed.data.environment,
      pushProvider: parsed.data.pushProvider ?? "FCM",
      deviceId: parsed.data.deviceId ?? readIdentityHeader(req.headers as Record<string, unknown>, IDENTITY_HEADER_DEVICE_ID),
      deviceInstallId:
        parsed.data.deviceInstallId ??
        readIdentityHeader(req.headers as Record<string, unknown>, IDENTITY_HEADER_DEVICE_INSTALL_ID),
      deviceFingerprint:
        parsed.data.deviceFingerprint ??
        readIdentityHeader(req.headers as Record<string, unknown>, IDENTITY_HEADER_DEVICE_FP),
      appVersion:
        parsed.data.appVersion ??
        readIdentityHeader(req.headers as Record<string, unknown>, IDENTITY_HEADER_APP_VERSION),
      buildNumber: parsed.data.buildNumber,
      locale:
        parsed.data.locale ??
        readIdentityHeader(req.headers as Record<string, unknown>, IDENTITY_HEADER_CLIENT_LANG),
      timezone:
        parsed.data.timezone ??
        readIdentityHeader(req.headers as Record<string, unknown>, IDENTITY_HEADER_CLIENT_TZ),
      metadata: parsed.data.metadata ?? null,
    });

    appendIdentityAudit({
      userId,
      email: req.session.email ?? null,
      category: "ACCOUNT_EVENT",
      type: "PUSH_DEVICE_REGISTERED",
      title: "Push device registered",
      description: `Registered ${device.platform} ${device.appVariant} push endpoint`,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
      actorType: "USER",
      actorUserId: userId,
      sessionId: req.sessionID,
      data: {
        deviceId: device.id,
        appVariant: device.appVariant,
        platform: device.platform,
        environment: device.environment,
      },
    });

    return res.json({ ok: true, device });
  } catch (error: any) {
    const message = error?.message === "PUSH_TOKEN_INVALID"
      ? "Invalid push token"
      : "Failed to register push device";
    const status = error?.message === "PUSH_TOKEN_INVALID" ? 400 : 500;
    console.error("[push] register failed", error);
    return res.status(status).json({ message });
  }
});

pushDevicesRouter.post("/unregister", async (req, res) => {
  const userId = Number(req.session.userId);
  const parsed = unregisterPushDeviceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid push device removal payload",
      issues: parsed.error.flatten(),
    });
  }

  try {
    const updated = parsed.data.all
      ? await revokeAllPushDevicesForUser(userId)
      : (await revokePushDeviceByToken(userId, parsed.data.token!)) ? 1 : 0;

    appendIdentityAudit({
      userId,
      email: req.session.email ?? null,
      category: "ACCOUNT_EVENT",
      type: parsed.data.all ? "PUSH_DEVICES_REVOKED" : "PUSH_DEVICE_REVOKED",
      title: parsed.data.all ? "All push devices revoked" : "Push device revoked",
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
      actorType: "USER",
      actorUserId: userId,
      sessionId: req.sessionID,
      data: {
        count: updated,
      },
    });

    return res.json({ ok: true, updated });
  } catch (error: any) {
    const message = error?.message === "PUSH_TOKEN_INVALID"
      ? "Invalid push token"
      : "Failed to unregister push device";
    const status = error?.message === "PUSH_TOKEN_INVALID" ? 400 : 500;
    console.error("[push] unregister failed", error);
    return res.status(status).json({ message });
  }
});

pushDevicesRouter.delete("/:id", async (req, res) => {
  const userId = Number(req.session.userId);
  const deviceId = parsePositiveInt(req.params.id);
  if (!deviceId) {
    return res.status(400).json({ message: "Invalid push device id" });
  }

  try {
    const revoked = await revokePushDeviceById(userId, deviceId);
    if (!revoked) {
      return res.status(404).json({ message: "Push device not found" });
    }

    appendIdentityAudit({
      userId,
      email: req.session.email ?? null,
      category: "ACCOUNT_EVENT",
      type: "PUSH_DEVICE_REVOKED",
      title: "Push device revoked",
      description: `Revoked push device ${deviceId}`,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
      actorType: "USER",
      actorUserId: userId,
      sessionId: req.sessionID,
      data: {
        deviceId,
      },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("[push] revoke-by-id failed", error);
    return res.status(500).json({ message: "Failed to revoke push device" });
  }
});
