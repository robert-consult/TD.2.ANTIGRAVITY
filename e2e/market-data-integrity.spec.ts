import { test, expect } from "@playwright/test";
import { login, installTradingViewStub } from "./utils";

const DEMO = { email: "demo@tradingfx.com", password: "demo1234" };
const ADMIN = { email: "admin@local.test", password: "changeme" };

test("RUNBOOK: import catalog → enable → trader sees symbol", async ({ browser }) => {
  const baseURL = "http://127.0.0.1:5000";
  const adminContext = await browser.newContext({ baseURL });
  const traderContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  const traderPage = await traderContext.newPage();

  const symbol = "ZZZUSD";

  try {
    installTradingViewStub(traderPage);
    await login(traderPage, DEMO.email, DEMO.password);
    await login(adminPage, ADMIN.email, ADMIN.password);

    await adminPage.goto("/admin");
    await expect(adminPage.getByText("Admin Dashboard")).toBeVisible();

    await adminPage.getByRole("tab", { name: /^Instr/i }).click();
    await adminPage.getByRole("tab", { name: "Ingestor" }).click();

    const catalog = [
      {
        category: "forex",
        canonicalSymbol: symbol,
        providerSymbol: "ZZZ/USD",
        name: "Integrity ZZZ/USD",
        currencyBase: "ZZZ",
        currencyQuote: "USD",
      },
    ];

    await adminPage.locator("#instrument-catalog-file").setInputFiles({
      name: "catalog.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(catalog), "utf-8"),
    });

    await Promise.all([
      adminPage.waitForResponse((r) => r.url().includes("/api/admin/market-data/instruments/reference/import") && r.status() === 200),
      adminPage.getByRole("button", { name: /^Import/ }).click(),
    ]);

    await adminPage.getByRole("tab", { name: "Configured" }).click();
    await adminPage.getByRole("button", { name: "Add From Catalog" }).click();

    const dialog = adminPage.getByRole("dialog");
    const searchInput = dialog.locator("#catalog-search");
    await searchInput.fill(symbol);
    await Promise.all([
      adminPage.waitForResponse((r) => r.url().includes("/api/admin/market-data/instruments/reference/search") && r.status() === 200),
      searchInput.press("Enter"),
    ]);

    const row = dialog.locator("tr", { hasText: symbol });
    await row.getByRole("checkbox").click();

    await Promise.all([
      adminPage.waitForResponse((r) => r.url().includes("/api/admin/market-data/instruments/reference/enable") && r.status() === 200),
      dialog.getByRole("button", { name: /^Enable/ }).click(),
    ]);

    let symbolId: number | null = null;
    await expect
      .poll(async () => {
        symbolId = await adminPage.evaluate(async (sym) => {
          const res = await fetch("/api/admin/symbols", { credentials: "include" });
          const data = await res.json();
          const row = Array.isArray(data) ? data.find((r: any) => String(r?.symbol ?? "").toUpperCase() === sym) : null;
          return row?.id ?? null;
        }, symbol);
        return symbolId;
      })
      .not.toBeNull();

    await expect
      .poll(async () => {
        return await traderPage.evaluate(async (sym) => {
          const res = await fetch("/api/config/symbols", { credentials: "include" });
          const data = await res.json();
          const symbols = Array.isArray(data) ? data.map((r: any) => String(r?.symbol ?? "").toUpperCase()) : [];
          return symbols.includes(sym);
        }, symbol);
      })
      .toBe(true);

    await traderPage.getByPlaceholder("Search instruments...").fill(symbol);
    await expect(traderPage.getByText(symbol)).toBeVisible();

    // Cleanup: remove the symbol config we created.
    if (symbolId != null) {
      await adminPage.evaluate(async (id) => {
        await fetch(`/api/admin/symbols/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
      }, symbolId);
    }

    await expect
      .poll(async () => {
        return await traderPage.evaluate(async (sym) => {
          const res = await fetch("/api/config/symbols", { credentials: "include" });
          const data = await res.json();
          const symbols = Array.isArray(data) ? data.map((r: any) => String(r?.symbol ?? "").toUpperCase()) : [];
          return symbols.includes(sym);
        }, symbol);
      })
      .toBe(false);
  } finally {
    await adminContext.close();
    await traderContext.close();
  }
});
