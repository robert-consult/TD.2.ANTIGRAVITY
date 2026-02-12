import type { CDPSession, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export type NetworkRequest = {
  url: string;
  method: string;
  type: string;
  ts: number;
};

export type NetworkResponse = {
  url: string;
  status: number;
  ts: number;
};

export class NetworkAudit {
  private urlByRequestId = new Map<string, string>();
  private typeByRequestId = new Map<string, string>();

  requests: NetworkRequest[] = [];
  responses: NetworkResponse[] = [];
  bytesByUrl = new Map<string, number>();
  totalEncodedBytes = 0;

  reset() {
    this.urlByRequestId.clear();
    this.typeByRequestId.clear();
    this.requests = [];
    this.responses = [];
    this.bytesByUrl.clear();
    this.totalEncodedBytes = 0;
  }

  onRequest(requestId: string, url: string, type: string, method: string) {
    this.urlByRequestId.set(requestId, url);
    this.typeByRequestId.set(requestId, type);
    this.requests.push({ url, type, method, ts: Date.now() });
  }

  onResponse(requestId: string, status: number) {
    const url = this.urlByRequestId.get(requestId);
    if (!url) return;
    this.responses.push({ url, status, ts: Date.now() });
  }

  onFinished(requestId: string, encodedBytes: number) {
    const url = this.urlByRequestId.get(requestId);
    if (!url) return;
    this.totalEncodedBytes += encodedBytes;
    this.bytesByUrl.set(url, (this.bytesByUrl.get(url) ?? 0) + encodedBytes);
  }

  urlsMatching(re: RegExp): string[] {
    return this.requests.map((r) => r.url).filter((url) => re.test(url));
  }

  countMatching(re: RegExp): number {
    return this.urlsMatching(re).length;
  }

  uniqueUrlsMatching(re: RegExp): string[] {
    return Array.from(new Set(this.urlsMatching(re)));
  }
}

export async function setupSlow4gMidCpuAudit(page: Page, opts?: { cpuThrottlingRate?: number }) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const audit = new NetworkAudit();

  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  const downloadThroughput = (1.6 * 1024 * 1024) / 8; // ~1.6 Mbps
  const uploadThroughput = (0.75 * 1024 * 1024) / 8; // ~0.75 Mbps
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput,
    uploadThroughput,
    connectionType: "cellular4g",
  });

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: opts?.cpuThrottlingRate ?? 4 });

  cdp.on("Network.requestWillBeSent", (ev: any) => {
    const url = String(ev?.request?.url ?? "");
    if (!url) return;
    audit.onRequest(String(ev.requestId), url, String(ev.type ?? ""), String(ev?.request?.method ?? ""));
  });

  cdp.on("Network.loadingFinished", (ev: any) => {
    const encoded = Number(ev?.encodedDataLength ?? 0);
    if (!Number.isFinite(encoded)) return;
    audit.onFinished(String(ev.requestId), encoded);
  });

  cdp.on("Network.responseReceived", (ev: any) => {
    const status = Number(ev?.response?.status ?? 0);
    if (!Number.isFinite(status) || status <= 0) return;
    audit.onResponse(String(ev.requestId), status);
  });

  return { cdp, audit };
}

export async function login(page: Page, email: string, password: string) {
  const emailInput = page.getByPlaceholder("email@example.com");
  const passwordInput = page.getByPlaceholder("********");

  const waitForLoginForm = async (timeoutMs: number) => {
    await expect(emailInput).toBeVisible({ timeout: timeoutMs });
    await expect(passwordInput).toBeVisible({ timeout: Math.min(timeoutMs, 20_000) });
  };

  await page.goto("/login");
  try {
    await waitForLoginForm(20_000);
  } catch {
    // Under throttled network emulation, Chromium can transiently surface
    // net::ERR_NETWORK_CHANGED while loading lazy chunks. Retry once.
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForLoginForm(60_000);
  }

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText("Live Quotes")).toBeVisible();
}

export async function acceptDoc1IfPrompted(page: Page): Promise<boolean> {
  const title = page.getByText("Updated Terms & Conditions");
  if (!(await title.isVisible().catch(() => false))) return false;

  const dialog = page.locator("[role=\"dialog\"]");
  const termsBox = dialog.locator("div.whitespace-pre-wrap");
  await termsBox.waitFor({ state: "visible" });

  // Scroll to end to enable acceptance.
  await termsBox.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });

  await page.getByLabel("I accept the Terms & Conditions").click();
  await page.getByRole("button", { name: "Accept & Continue" }).click();
  await expect(title).toBeHidden();
  return true;
}

export function installTradingViewStub(page: Page, tracker?: { called: () => void }) {
  const stub = [
    "(() => {",
    "  window.TradingView = {",
    "    widget: function() {",
    "      return {",
    "        remove: function() {},",
    "      };",
    "    }",
    "  };",
    "})();",
  ].join("\n");

  return page.route("https://s3.tradingview.com/tv.js", async (route) => {
    tracker?.called?.();
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: stub,
    });
  });
}
