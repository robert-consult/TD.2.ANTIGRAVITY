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
  const openPlatform = page.getByRole("button", { name: "Open Platform" });

  const waitForLoginForm = async (timeoutMs: number) => {
    await page.evaluate(() => {
      const start = (window as any).__tqBootNow;
      if (typeof start === "function") start();
    });
    if (await openPlatform.isVisible().catch(() => false)) {
      await openPlatform.click().catch(() => undefined);
      await page.evaluate(() => {
        const start = (window as any).__tqBootNow;
        if (typeof start === "function") start();
      });
    }
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
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
    .not.toBe("/login");

  const isReadyAfterLogin = async () => {
    const tradeButtonVisible = await page
      .getByRole("button", { name: "Trade" })
      .first()
      .isVisible()
      .catch(() => false);
    const quotesTitleVisible = await page.getByText("Live Quotes").isVisible().catch(() => false);
    return tradeButtonVisible || quotesTitleVisible;
  };

  await expect.poll(isReadyAfterLogin, { timeout: 60_000 }).toBe(true);
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

type EnsureTradeCapacityOptions = {
  symbol?: string;
  maxActivePerSymbol?: number;
  maxIterations?: number;
};

export async function ensureTradeCapacity(
  page: Page,
  options?: EnsureTradeCapacityOptions,
): Promise<void> {
  const symbol = String(options?.symbol ?? "USDJPY").toUpperCase();
  const maxActivePerSymbol = Math.max(0, Number(options?.maxActivePerSymbol ?? 1));
  const maxIterations = Math.max(1, Number(options?.maxIterations ?? 8));

  const result = await page.evaluate(
    async ({ symbol, maxActivePerSymbol, maxIterations }) => {
      const normalizeSymbol = (value: unknown): string => String(value ?? "").trim().toUpperCase();
      const targetSymbol = normalizeSymbol(symbol);

      const readRows = async (url: string): Promise<any[]> => {
        try {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) return [];
          const body = await res.json().catch(() => []);
          return Array.isArray(body) ? body : [];
        } catch {
          return [];
        }
      };

      const rowSymbol = (row: any): string => {
        if (row?.symbol && typeof row.symbol === "string") return normalizeSymbol(row.symbol);
        if (row?.symbol && typeof row.symbol === "object") return normalizeSymbol(row.symbol.symbol);
        return "";
      };

      const filterBySymbol = (rows: any[]) =>
        rows.filter((row) => !targetSymbol || rowSymbol(row) === targetSymbol);

      const countActive = (openRows: any[], pendingRows: any[]) =>
        filterBySymbol(openRows).length + filterBySymbol(pendingRows).length;

      let remaining = 0;
      for (let attempt = 0; attempt < maxIterations; attempt += 1) {
        const [openRows, pendingRows] = await Promise.all([
          readRows("/api/trades/open"),
          readRows("/api/trades/pending"),
        ]);
        remaining = countActive(openRows, pendingRows);
        if (remaining <= maxActivePerSymbol) {
          return { ok: true, remaining };
        }

        let didMutate = false;

        for (const row of filterBySymbol(pendingRows)) {
          if (remaining <= maxActivePerSymbol) break;
          const id = Number(row?.id);
          if (!Number.isInteger(id) || id <= 0) continue;
          try {
            const res = await fetch(`/api/trades/${id}/cancel`, {
              method: "PATCH",
              credentials: "include",
            });
            if (res.status < 500) {
              didMutate = true;
              remaining -= 1;
            }
          } catch {
            // keep iterating
          }
        }

        if (remaining > maxActivePerSymbol) {
          for (const row of filterBySymbol(openRows)) {
            if (remaining <= maxActivePerSymbol) break;
            const id = Number(row?.id);
            if (!Number.isInteger(id) || id <= 0) continue;
            try {
              const res = await fetch(`/api/trades/${id}/close`, {
                method: "POST",
                credentials: "include",
              });
              if (res.status < 400) {
                didMutate = true;
                remaining -= 1;
              }
            } catch {
              // keep iterating
            }
          }
        }

        if (!didMutate) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      return { ok: remaining <= maxActivePerSymbol, remaining };
    },
    { symbol, maxActivePerSymbol, maxIterations },
  );

  if (!result.ok) {
    throw new Error(
      `Unable to reduce active trades for ${symbol} to <= ${maxActivePerSymbol}. Remaining: ${result.remaining}`,
    );
  }
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
