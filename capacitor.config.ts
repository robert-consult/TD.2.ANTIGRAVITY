import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = String(process.env.CAPACITOR_SERVER_URL || "").trim();

const config: CapacitorConfig = {
  appId: "com.tradequip.app",
  appName: "TradeQuip",
  webDir: "dist/public",
  bundledWebRuntime: false,
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: serverUrl.startsWith("http://"),
          androidScheme: serverUrl.startsWith("https://") ? "https" : "http",
        },
      }
    : {}),
};

export default config;

