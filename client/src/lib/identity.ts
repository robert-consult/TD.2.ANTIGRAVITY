import {
  DEVICE_INSTALL_ID_STORAGE_KEY,
  IDENTITY_HEADER_CLIENT_LANG,
  IDENTITY_HEADER_CLIENT_TZ,
  IDENTITY_HEADER_DEVICE_FP,
  IDENTITY_HEADER_DEVICE_ID,
  IDENTITY_HEADER_DEVICE_INSTALL_ID,
  LEGACY_DEVICE_ID_STORAGE_KEY,
} from "@shared/identity/headers";
import { generateIdentityId } from "@shared/identity/device";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from "@shared/locale/preferences";

let fingerprintPromise: Promise<string> | null = null;

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors
  }
}

export function getDeviceInstallId(): string {
  let id = safeGetItem(DEVICE_INSTALL_ID_STORAGE_KEY);
  if (!id) {
    id = generateIdentityId();
    safeSetItem(DEVICE_INSTALL_ID_STORAGE_KEY, id);
  }
  return id;
}

export function getLegacyDeviceId(): string {
  let id = safeGetItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  if (!id) {
    id = generateIdentityId();
    safeSetItem(LEGACY_DEVICE_ID_STORAGE_KEY, id);
  }
  return id;
}

export async function getDeviceFingerprint(): Promise<string> {
  if (fingerprintPromise) {
    return fingerprintPromise;
  }

  fingerprintPromise = (async () => {
    const components: string[] = [];

    components.push(navigator.userAgent);
    components.push(navigator.language);
    components.push(String(navigator.hardwareConcurrency || 0));
    components.push(String(screen.width) + "x" + String(screen.height));
    components.push(String(screen.colorDepth));
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = 200;
        canvas.height = 50;
        ctx.textBaseline = "top";
        ctx.font = "14px 'Arial'";
        ctx.fillStyle = "#f60";
        ctx.fillRect(0, 0, 125, 50);
        ctx.fillStyle = "#069";
        ctx.fillText("GriftDetect", 2, 15);
        ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
        ctx.fillText("Fingerprint", 4, 30);
        components.push(canvas.toDataURL());
      }
    } catch {
      components.push("canvas-error");
    }

    const webglInfo = getWebGLInfo();
    if (webglInfo) {
      components.push(webglInfo);
    }

    const data = components.join("|");
    const hash = await sha256(data);
    return hash;
  })();

  return fingerprintPromise;
}

function getWebGLInfo(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl && gl instanceof WebGLRenderingContext) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        return `${vendor}~${renderer}`;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export function getClientTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getClientLanguage(): string {
  const saved = safeGetItem(LOCALE_STORAGE_KEY);
  if (saved) return saved;
  return navigator.language || DEFAULT_LOCALE;
}

export async function getIdentityHeaders(): Promise<Record<string, string>> {
  const deviceFp = await getDeviceFingerprint();
  const headers: Record<string, string> = {
    [IDENTITY_HEADER_DEVICE_INSTALL_ID]: getDeviceInstallId(),
    [IDENTITY_HEADER_DEVICE_ID]: getLegacyDeviceId(),
    [IDENTITY_HEADER_DEVICE_FP]: deviceFp,
    [IDENTITY_HEADER_CLIENT_TZ]: getClientTimezone(),
    [IDENTITY_HEADER_CLIENT_LANG]: getClientLanguage(),
  };

  if (!headers[IDENTITY_HEADER_DEVICE_ID]) {
    delete headers[IDENTITY_HEADER_DEVICE_ID];
  }

  return headers;
}
