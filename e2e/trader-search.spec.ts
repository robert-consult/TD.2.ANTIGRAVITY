import { test, expect, type Page } from "@playwright/test";
import { acceptDoc1IfPrompted, login } from "./utils";

const DEMO = { email: "demo@tradingfx.com", password: "demo1234" };
const ADMIN = { email: "admin@local.test", password: "changeme" };

async function navigateToTrade(page: Page) {
  await page.getByRole("button", { name: "Trade" }).first().click();
  await expect(page.locator('[data-testid="trade-tab-scroll"]')).toBeVisible();
}

async function closeOneIfPresent(page: Page): Promise<boolean> {
  await page.getByRole("tab", { name: /Positions/ }).click();
  const positionsPanel = page.locator('[data-testid="trade-active-positions"]');
  const closeButtons = positionsPanel.getByRole("button", { name: /^Close$/ });
  const count = await closeButtons.count();
  if (count === 0) return false;

  const closeReq = page.waitForResponse(
    (res) => /\/api\/trades\/\d+\/close$/.test(res.url()) && res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await closeButtons.first().click();
  const closeRes = await closeReq;
  expect(closeRes.status(), await closeRes.text()).toBeLessThan(400);
  return true;
}

async function openAndCloseOneTrade(page: Page) {
  await page.getByRole("tab", { name: "Place Order" }).click();
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

  await page.getByRole("tab", { name: /Positions/ }).click();
  const positionsPanel = page.locator('[data-testid="trade-active-positions"]');
  await expect(positionsPanel.locator("tbody tr").first()).toBeVisible({ timeout: 60_000 });

  const closeReq = page.waitForResponse(
    (res) => /\/api\/trades\/\d+\/close$/.test(res.url()) && res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await positionsPanel.getByRole("button", { name: /^Close$/ }).first().click();
  const closeRes = await closeReq;
  expect(closeRes.status(), await closeRes.text()).toBeLessThan(400);
}

test("Admin: Trader Search supports optional criteria + drilldown", async ({ browser }) => {
  test.setTimeout(240_000);

  const baseURL = "http://127.0.0.1:5000";
  const traderContext = await browser.newContext({ baseURL });
  const adminContext = await browser.newContext({ baseURL });
  const traderPage = await traderContext.newPage();
  const adminPage = await adminContext.newPage();

  try {
    // 1) Create at least one CLOSED trade for a non-admin user (source of truth: trades table).
    await login(traderPage, DEMO.email, DEMO.password);
    await navigateToTrade(traderPage);
    const closedExisting = await closeOneIfPresent(traderPage);
    if (!closedExisting) {
      await openAndCloseOneTrade(traderPage);
    }

    // 2) Admin opens Trader Search and verifies filters do not require q/username/email.
    await login(adminPage, ADMIN.email, ADMIN.password);
    await acceptDoc1IfPrompted(adminPage);
    await adminPage.goto("/admin");
    await acceptDoc1IfPrompted(adminPage);
    await expect(adminPage.getByText("Admin Dashboard")).toBeVisible();

    await adminPage.getByRole("tab", { name: "Data" }).click({ timeout: 30_000 });
    await expect(adminPage.getByText("Trading Data")).toBeVisible();

    await adminPage.getByRole("button", { name: "Trader Search" }).click();
    await expect(adminPage.getByTestId("admin-trader-search")).toBeVisible();

    // Ensure blank q still yields results (q is optional).
    await adminPage.getByTestId("trader-search-q").fill("");
    await adminPage.getByTestId("trader-search-min-trades").fill("1");

    // Categories are optional; "FX" filter must work without requiring other fields.
    await adminPage.getByRole("button", { name: "FX" }).click();

    const demoRow = adminPage.locator('table[data-testid="trader-search-results"] tbody tr').filter({
      hasText: DEMO.email,
    });
    await expect(demoRow.first()).toBeVisible({ timeout: 60_000 });

    // Drilldown should load category breakdown and trade extremes from admin endpoints.
    await demoRow.getByRole("button", { name: "Drilldown" }).first().click();
    await expect(adminPage.getByTestId("trader-search-drilldown")).toBeVisible();

    await expect(adminPage.getByText("Category breakdown")).toBeVisible({ timeout: 60_000 });
    await expect(
      adminPage.getByTestId("trader-search-drilldown").getByRole("cell", { name: "forex" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(adminPage.getByText("Top / Bottom trades")).toBeVisible();
  } finally {
    await adminContext.close();
    await traderContext.close();
  }
});
