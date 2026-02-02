import { test, expect } from "@playwright/test";
import { acceptDoc1IfPrompted, installTradingViewStub, login, setupSlow4gMidCpuAudit } from "./utils";

const DEMO = { email: "demo@tradingfx.com", password: "demo1234" };
const ADMIN = { email: "admin@local.test", password: "changeme" };

test("RUNBOOK: WS connects only when authenticated", async ({ page }) => {
  const wsUrls: string[] = [];
  page.on("websocket", (ws) => wsUrls.push(ws.url()));

  await setupSlow4gMidCpuAudit(page, { cpuThrottlingRate: 4 });
  await page.goto("/login");
  await page.waitForTimeout(500);

  expect(wsUrls.filter((u) => u.includes("/ws")).length).toBe(0);

  await login(page, DEMO.email, DEMO.password);

  await expect
    .poll(() => wsUrls.filter((u) => u.includes("/ws")).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
});

test("RUNBOOK: trader session does not fetch admin bundle", async ({ page }) => {
  const { audit } = await setupSlow4gMidCpuAudit(page, { cpuThrottlingRate: 4 });
  installTradingViewStub(page);

  await login(page, DEMO.email, DEMO.password);
  await page.waitForTimeout(1500);

  const adminChunkRequests = () =>
    audit.requests.filter((r) => r.url.includes("/assets/AdminDashboard-") && r.url.includes(".js")).length;
  expect(adminChunkRequests()).toBe(0);

  // Even when a non-admin tries to hit /admin, we must not lazy-load the admin code.
  await page.goto("/admin");
  await page.waitForTimeout(1000);
  expect(adminChunkRequests()).toBe(0);
});

test("RUNBOOK: admin bundle loads only on /admin navigation", async ({ page }) => {
  const { audit } = await setupSlow4gMidCpuAudit(page, { cpuThrottlingRate: 4 });
  installTradingViewStub(page);

  await login(page, ADMIN.email, ADMIN.password);
  await page.waitForTimeout(1500);

  const adminChunkRequests = () =>
    audit.requests.filter((r) => r.url.includes("/assets/AdminDashboard-") && r.url.includes(".js")).length;
  expect(adminChunkRequests()).toBe(0);

  await page.goto("/admin");
  await expect(page.getByText("Admin Dashboard")).toBeVisible();
  expect(adminChunkRequests()).toBeGreaterThan(0);
});

test("RUNBOOK: instruments config dictates trader quotes", async ({ browser }) => {
  const baseURL = "http://127.0.0.1:5000";
  const adminContext = await browser.newContext({ baseURL });
  const traderContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  const traderPage = await traderContext.newPage();

  try {
    await setupSlow4gMidCpuAudit(traderPage, { cpuThrottlingRate: 4 });

    await login(traderPage, DEMO.email, DEMO.password);
    await login(adminPage, ADMIN.email, ADMIN.password);
    await adminPage.goto("/admin");
    await expect(adminPage.getByText("Admin Dashboard")).toBeVisible();

    const symbolConfigs: Array<{ id: number; symbol: string; enabled: boolean }> =
      await adminPage.evaluate(async () => {
        const res = await fetch("/api/admin/symbols", { credentials: "include" });
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      });

    expect(symbolConfigs.length).toBeGreaterThan(0);
    const keepSymbol =
      symbolConfigs.find((s) => String(s.symbol).toUpperCase() === "USDJPY")?.symbol ??
      symbolConfigs.find((s) => s.enabled)?.symbol ??
      symbolConfigs[0].symbol;
    const keepSymbolUpper = String(keepSymbol).toUpperCase();

    const changed = new Map<number, boolean>();
    for (const cfg of symbolConfigs) {
      const symbolUpper = String(cfg.symbol).toUpperCase();
      const nextEnabled = symbolUpper === keepSymbolUpper;
      if (cfg.enabled === nextEnabled) continue;

      changed.set(cfg.id, cfg.enabled);
      await adminPage.evaluate(
        async ({ id, enabled }) => {
          await fetch(`/api/admin/symbols/${id}`, {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled }),
          });
        },
        { id: cfg.id, enabled: nextEnabled },
      );
    }

    await expect
      .poll(async () => {
        return await traderPage.evaluate(async () => {
          const res = await fetch("/api/config/symbols", { credentials: "include" });
          const data = await res.json();
          return Array.isArray(data)
            ? data
                .map((s: any) => String(s?.symbol ?? "").toUpperCase())
                .filter(Boolean)
                .sort()
            : [];
        });
      })
      .toEqual([keepSymbolUpper]);

    await expect(traderPage.getByText(keepSymbolUpper)).toBeVisible();
    for (const cfg of symbolConfigs) {
      const symbolUpper = String(cfg.symbol).toUpperCase();
      if (symbolUpper === keepSymbolUpper) continue;
      await expect(traderPage.getByText(symbolUpper)).toBeHidden();
    }

    // Re-enable one instrument and ensure it appears without a hard refresh.
    const addCandidate = symbolConfigs.find((s) => String(s.symbol).toUpperCase() !== keepSymbolUpper);
    if (addCandidate) {
      const addSymbolUpper = String(addCandidate.symbol).toUpperCase();
      if (!changed.has(addCandidate.id)) {
        const initial = symbolConfigs.find((s) => s.id === addCandidate.id);
        changed.set(addCandidate.id, Boolean(initial?.enabled));
      }
      await adminPage.evaluate(
        async ({ id }) => {
          await fetch(`/api/admin/symbols/${id}`, {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          });
        },
        { id: addCandidate.id },
      );

      await expect
        .poll(async () => {
          return await traderPage.evaluate(async () => {
            const res = await fetch("/api/config/symbols", { credentials: "include" });
            const data = await res.json();
            return Array.isArray(data)
              ? data
                  .map((s: any) => String(s?.symbol ?? "").toUpperCase())
                  .filter(Boolean)
                  .sort()
              : [];
          });
        })
        .toEqual([keepSymbolUpper, addSymbolUpper].sort());

      await expect(traderPage.getByText(addSymbolUpper)).toBeVisible();
    }

    // Restore changes for subsequent tests.
    for (const [id, enabled] of changed.entries()) {
      await adminPage.evaluate(
        async ({ id, enabled }) => {
          await fetch(`/api/admin/symbols/${id}`, {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled }),
          });
        },
        { id, enabled },
      );
    }
  } finally {
    await adminContext.close();
    await traderContext.close();
  }
});

test("RUNBOOK: chart provider not fetched until Chart tab is opened", async ({ page }) => {
  const { audit } = await setupSlow4gMidCpuAudit(page, { cpuThrottlingRate: 4 });
  installTradingViewStub(page);

  await login(page, DEMO.email, DEMO.password);
  await page.waitForTimeout(1500);

  const tvScriptRequests = () =>
    audit.requests.filter((r) => r.url.startsWith("https://s3.tradingview.com/tv.js")).length;
  expect(tvScriptRequests()).toBe(0);

  await page.getByRole("button", { name: "Chart" }).first().click();
  await expect(page.getByText("Symbol chart")).toBeVisible();

  await expect
    .poll(() => tvScriptRequests(), { timeout: 30_000 })
    .toBeGreaterThan(0);
});

test("RUNBOOK: no fast polling + trade flow works under Slow 4G", async ({ page }) => {
  const { audit } = await setupSlow4gMidCpuAudit(page, { cpuThrottlingRate: 4 });
  installTradingViewStub(page);

  await login(page, DEMO.email, DEMO.password);

  // Focus post-login traffic for polling assertions.
  audit.reset();

  await page.getByRole("button", { name: "Trade" }).first().click();
  await expect(page.locator('[data-testid="trade-tab-scroll"]')).toBeVisible();

  const buyButton = page.locator("button.btn-buy");
  await expect(buyButton).toBeEnabled({ timeout: 60_000 });
  await buyButton.click();

  const acceptedTerms = await acceptDoc1IfPrompted(page);
  // If terms were required, the first click can be consumed by the gate.
  if (acceptedTerms) {
    await page.getByRole("tab", { name: "Place Order" }).click();
    await expect(buyButton).toBeEnabled({ timeout: 60_000 });
    await buyButton.click();
  }

  await expect
    .poll(
      () => audit.requests.filter((r) => r.method === "POST" && r.url.endsWith("/api/trades")).length,
      { timeout: 60_000 }
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        audit.responses.filter((r) => r.url.endsWith("/api/trades") && r.status >= 200 && r.status < 300).length,
      { timeout: 60_000 }
    )
    .toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Active Positions" }).click();
  await expect(page.getByRole("tab", { name: "Active Positions" })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("cell", { name: "USDJPY" }).first()).toBeVisible();

  // Wait a bit and ensure we don't spam hot endpoints.
  await page.waitForTimeout(12_000);
  const authCurrentUserCalls = audit.requests.filter((r) => r.url.includes("/api/auth/current-user")).length;
  const accountSummaryCalls = audit.requests.filter((r) => r.url.includes("/api/account/summary")).length;
  expect(authCurrentUserCalls).toBe(0);
  expect(accountSummaryCalls).toBeLessThanOrEqual(1);
});

test("RUNBOOK: production caching headers for HTML/assets", async ({ request }) => {
  // HTML should be no-cache.
  const htmlRes = await request.get("/", {
    headers: { Accept: "text/html" },
  });
  expect(htmlRes.status()).toBe(200);
  expect(htmlRes.headers()["cache-control"]).toContain("no-cache");

  const html = await htmlRes.text();
  expect(html).not.toMatch(/preconnect/i);
  expect(html).not.toMatch(/tradingview/i);

  const token = 'src="/assets/';
  const start = html.indexOf(token);
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = html.slice(start + token.length);
  const end = slice.indexOf('"');
  expect(end).toBeGreaterThan(0);
  const entry = `/assets/${slice.slice(0, end)}`;

  const assetRes = await request.get(entry, { headers: { "Accept-Encoding": "br" } });
  expect(assetRes.status()).toBe(200);
  expect(assetRes.headers()["cache-control"]).toContain("immutable");
  expect(assetRes.headers()["vary"]).toContain("Accept-Encoding");
});
