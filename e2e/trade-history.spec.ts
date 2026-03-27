import { test, expect, type Page } from "@playwright/test";
import { acceptDoc1IfPrompted, ensureTradeCapacity, login, waitForFreshQuote } from "./utils";

const DEMO = { email: "demo@tradingfx.com", password: "demo1234" };

async function navigateToTrade(page: Page) {
  await page.getByRole("button", { name: "Trade" }).first().click();
  await expect(page.locator('[data-testid="trade-tab-scroll"]')).toBeVisible();
}

async function navigateToHistory(page: Page) {
  await page.getByRole("button", { name: "History" }).first().click();
  await expect(page.getByRole("heading", { name: "Trade History" })).toBeVisible();
}

async function closeOneIfPresent(page: Page): Promise<number | null> {
  await page.getByRole("tab", { name: /Positions/ }).click();
  const positionsPanel = page.locator('[data-testid="trade-active-positions"]');
  const firstPositionRow = positionsPanel.locator("tbody tr").first();
  if ((await firstPositionRow.count()) === 0) return null;
  await firstPositionRow.click();

  const closeButton = positionsPanel.getByRole("button", { name: /close/i }).first();
  if ((await closeButton.count()) === 0) return null;
  await expect(closeButton).toBeVisible({ timeout: 60_000 });

  const closeReq = page.waitForResponse(
    (res) => /\/api\/trades\/\d+\/close$/.test(res.url()) && res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await closeButton.click();
  const closeRes = await closeReq;
  expect(closeRes.status(), await closeRes.text()).toBeLessThan(400);

  const closedTrade = await closeRes.json().catch(() => null);
  const closedId = closedTrade?.id;
  return typeof closedId === "number" ? closedId : null;
}

test("Trade: closing a position shows in history", async ({ page }) => {
  test.setTimeout(180_000);

  await login(page, DEMO.email, DEMO.password);
  await acceptDoc1IfPrompted(page);
  await navigateToTrade(page);
  let closedId = await closeOneIfPresent(page);
  if (closedId === null) {
    await ensureTradeCapacity(page, { symbol: "USDJPY", maxActivePerSymbol: 2 });
    await waitForFreshQuote(page, { symbol: "USDJPY" });

    const buyButton = page.locator("button.btn-buy");
    await expect(buyButton).toBeEnabled({ timeout: 60_000 });

    const marketPost1 = page.waitForResponse(
      (res) => res.url().endsWith("/api/trades") && res.request().method() === "POST",
      { timeout: 60_000 },
    );
    await buyButton.click();
    const marketRes1 = await marketPost1;

    const acceptedTerms = await acceptDoc1IfPrompted(page);
    if (acceptedTerms) {
      await page.getByRole("tab", { name: "Place Order" }).click();
      await expect(buyButton).toBeEnabled({ timeout: 60_000 });
      const marketPost2 = page.waitForResponse(
        (res) => res.url().endsWith("/api/trades") && res.request().method() === "POST",
        { timeout: 60_000 },
      );
      await buyButton.click();
      const marketRes2 = await marketPost2;
      expect(marketRes2.status(), await marketRes2.text()).toBeLessThan(400);
    } else {
      expect(marketRes1.status(), await marketRes1.text()).toBeLessThan(400);
    }

    closedId = await closeOneIfPresent(page);
  }

  expect(typeof closedId).toBe("number");

  await navigateToHistory(page);
  await page.locator("main").getByText("USDJPY").first().click();
  await expect(page.getByText(String(closedId), { exact: true })).toBeVisible({ timeout: 60_000 });
});
