import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for TradeQuip Mobile App
 * 
 * This uses REMOTE URL MODE to wrap the web application.
 * Set CAPACITOR_SERVER_URL to override the runtime origin.
 * Production defaults to https://tradehub.example.com so wrapper builds stay in remote-URL mode.
 * 
 * Examples:
 *   - Android Emulator/Device (recommended): http://localhost:5000 (after `adb reverse tcp:5000 tcp:5000`)
 *   - Android Emulator/Device (trusted HTTPS tunnel): https://<random>.trycloudflare.com
 *   - Production: https://tradehub.example.com
 *
 * Note: This app relies on WebCrypto (`crypto.subtle`) for identity/bot-proof. WebCrypto requires a secure
 * context, so `http://10.0.2.2:5000` / `http://192.168.x.x:5000` will break login on Android WebView.
 */

const serverUrl = String(
  process.env.CAPACITOR_SERVER_URL ||
  process.env.APP_URL ||
  (process.env.NODE_ENV === "production" ? "https://tradehub.example.com" : ""),
).trim();
const serverHost = (() => {
  if (!serverUrl) return "";
  try {
    return new URL(serverUrl).host;
  } catch {
    return "";
  }
})();
const allowNavigationHosts = Array.from(
  new Set([
    "tradehub.example.com",
    "staging.tradehub.example.com",
    serverHost,
  ].filter(Boolean)),
);

const config: CapacitorConfig = {
  appId: "com.tradequip.app",
  appName: "TradeQuip",
  webDir: "../dist/public",

  // Server configuration for remote URL mode
  ...(serverUrl
    ? {
      server: {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
        androidScheme: serverUrl.startsWith("https://") ? "https" : "http",
        iosScheme: serverUrl.startsWith("https://") ? "https" : "http",
        allowNavigation: allowNavigationHosts,
      },
    }
    : {}),

  // Android-specific configuration
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: process.env.NODE_ENV !== "production",
  },

  ios: {
    contentInset: "automatic",
  },

  // Plugin configuration
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#0a1628",
      showSpinner: true,
      spinnerColor: "#3b82f6",
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "Dark",
      backgroundColor: "#0a1628",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
