import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const localLibDir = path.resolve(".tmp/playwright-deps/root/usr/lib/x86_64-linux-gnu");
const launchEnv = fs.existsSync(localLibDir)
  ? {
      ...process.env,
      LD_LIBRARY_PATH: [localLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
    }
  : undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:5000",
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    launchOptions: launchEnv ? { env: launchEnv } : undefined,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run start:e2e",
    url: "http://127.0.0.1:5000/ready",
    reuseExistingServer: process.env.PW_REUSE_EXISTING_SERVER === "1",
    timeout: 120_000,
  },
});
