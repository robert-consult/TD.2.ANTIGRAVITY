// client/src/lib/deviceId.ts
import { LEGACY_DEVICE_ID_STORAGE_KEY } from "@shared/identity/headers";
import { generateIdentityId } from "@shared/identity/device";

function generateDeviceId(): string {
  return generateIdentityId();
}

export function getDeviceId(): string {
  let deviceId = localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  if (!deviceId) {
    deviceId = generateDeviceId();
    localStorage.setItem(LEGACY_DEVICE_ID_STORAGE_KEY, deviceId);
  }
  return deviceId;
}

export function getDeviceFingerprint(): string {
  // Canvas fingerprint
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Grift", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("Detection", 4, 17);
  }
  const canvasData = canvas.toDataURL();

  // WebGL fingerprint
  let webglHash = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        webglHash = `${vendor}~${renderer}`;
      }
    }
  } catch (e) {
    // Ignore WebGL errors
  }

  // Combine into fingerprint
  const raw = `${canvasData}|${webglHash}|${screen.width}x${screen.height}|${navigator.hardwareConcurrency}|${navigator.language}`;

  // Simple hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export function getClientMetadata() {
  return {
    deviceId: getDeviceId(),
    fingerprint: getDeviceFingerprint(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    screenResolution: `${screen.width}x${screen.height}`,
    colorDepth: screen.colorDepth,
    platform: navigator.platform,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
  };
}
