import { test, expect, type Page } from "@playwright/test";
import { acceptDoc1IfPrompted, login } from "./utils";

const DEMO = { email: "demo@tradingfx.com", password: "demo1234" };

async function navigateToTrade(page: Page) {
  await page.getByRole("button", { name: "Trade" }).first().click();
  await expect(page.locator('[data-testid="trade-tab-scroll"]')).toBeVisible();
}

test("Trade: header collapse does not reset scroll + tables remain expandable on resize", async ({ page }) => {
  test.setTimeout(180_000);
  const wideWidth = 740; // < 768 so the Trade header auto-collapses
  const narrowWidth = 390;
  await page.setViewportSize({ width: narrowWidth, height: 760 });

  await login(page, DEMO.email, DEMO.password);
  await navigateToTrade(page);

  const scroll = page.locator('[data-testid="trade-tab-scroll"]');
  const header = page.locator('[data-testid="trade-header-shell"]');

  const buyButton = page.locator("button.btn-buy");
  await expect(buyButton).toBeEnabled({ timeout: 60_000 });
  // Place a market order quickly (quotes can go stale in E2E if we wait too long).
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

  // Place a pending Stop order early to avoid quote staleness flaking the test.
  await page.getByRole("tab", { name: "Place Order" }).click();
  await page.getByRole("button", { name: /^Stop$/ }).click();
  const stopInput = page.locator('input[name="stopPrice"]');
  await expect(stopInput).toBeVisible();

  // Set a deterministic Stop price based on server-side quotes (avoids client/server tick skew flaking the test).
  const serverAsk = await page.evaluate(async () => {
    const res = await fetch("/api/quotes/USDJPY", { credentials: "include" });
    const data = await res.json().catch(() => null);
    const ask = data?.ask ?? data?.price ?? null;
    return typeof ask === "number" ? ask : Number(ask);
  });
  const stopPx = Number.isFinite(serverAsk) ? serverAsk + 0.5 /* 50 pips */ : 150;
  await stopInput.fill(stopPx.toFixed(3));

  const tpInput = page.locator('input[name="takeProfit"]');
  const slInput = page.locator('input[name="stopLoss"]');
  await expect(tpInput).toHaveValue(/\S+/, { timeout: 60_000 });
  await expect(slInput).toHaveValue(/\S+/, { timeout: 60_000 });

  const submitSingle = page.locator('button[type="submit"][form="trade-order-form"]').first();
  await expect(submitSingle).toBeEnabled({ timeout: 60_000 });
  const pendingPost = page.waitForResponse(
    (res) => res.url().endsWith("/api/trades") && res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await submitSingle.click();
  const pendingRes = await pendingPost;
  expect(pendingRes.status(), await pendingRes.text()).toBeLessThan(400);

  // Ensure the pending trade exists server-side (WS-driven UI updates can lag slightly).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const res = await fetch("/api/trades/pending", { credentials: "include" });
          const data = await res.json().catch(() => null);
          return Array.isArray(data) ? data.length : 0;
        }),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  // Ensure the Trade header collapses progressively on scroll (no abrupt jumps).
  await page.getByRole("tab", { name: "Place Order" }).click();
  await expect(page.locator("#trade-order-form")).toBeVisible();
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() => header.evaluate((el) => el.style.height), { timeout: 10_000 })
    .toMatch(/px/);
  const expandedHeight = await header.evaluate((el) => Number.parseFloat(el.style.height) || el.getBoundingClientRect().height);
  await scroll.evaluate((el) => {
    el.scrollTop = Math.min(240, el.scrollHeight);
    el.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(
      () => header.evaluate((el) => Number.parseFloat(el.style.height) || el.getBoundingClientRect().height),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(expandedHeight);

  // Switch to a wide-but-still-"mobile" width to reproduce the previous scrollbar hysteresis loop.
  await page.setViewportSize({ width: wideWidth, height: 620 });

  await page.getByRole("tab", { name: /Positions/ }).click();
  const positionsPanel = page.locator('[data-testid="trade-active-positions"]');
  await expect(positionsPanel.locator("tbody tr").first()).toBeVisible({ timeout: 60_000 });

  await scroll.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });

  // Calibrate viewport height so the tab scroll overflow is small.
  // This reproduces the prior flicker loop where collapsing the header could make content "fit",
  // clamping scrollTop back to 0 and causing a collapse/expand oscillation.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Missing viewport size");
  const targetOverflow = 40;
  const initial = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  const desiredClientHeight = initial.sh - targetOverflow;
  const delta = desiredClientHeight - initial.ch;
  let tunedHeight = Math.max(320, Math.min(920, Math.round(viewport.height + delta)));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.setViewportSize({ width: wideWidth, height: tunedHeight });
    const overflow = await scroll.evaluate((el) => el.scrollHeight - el.clientHeight);
    if (overflow > 0) break;
    tunedHeight = Math.max(320, tunedHeight - 40);
  }

  // Scroll to bottom and ensure scrollTop doesn't reset back to 0 over subsequent frames.
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });

  const scrollStayedNonZero = await page.evaluate(async () => {
    const el = document.querySelector<HTMLElement>('[data-testid="trade-tab-scroll"]');
    if (!el) return false;
    const overflow = el.scrollHeight - el.clientHeight;
    // If there's no overflow, browsers can clamp scrollTop to 0 legitimately.
    if (overflow <= 0) return true;
    const startTop = el.scrollTop;
    if (startTop <= 0) return false;

    const start = performance.now();
    let minTop = startTop;
    return await new Promise<boolean>((resolve) => {
      const step = () => {
        minTop = Math.min(minTop, el.scrollTop);
        if (performance.now() - start > 600) resolve(minTop > 0);
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
  expect(scrollStayedNonZero).toBe(true);

  // Resize narrow to force progressive column hiding, then confirm expandable rows show hidden fields.
  await page.setViewportSize({ width: 360, height: 760 });
  await expect(positionsPanel.getByRole("columnheader", { name: "Open Time" })).toBeHidden({ timeout: 10_000 });
  await positionsPanel.locator("tbody tr").first().click();
  await expect(positionsPanel.getByText("Open Time")).toBeVisible();

  // Pending Orders: confirm expandability for hidden TP/SL.
  await page.getByRole("tab", { name: /Pending/ }).click();
  const pendingPanel = page.locator('[data-testid="trade-pending-orders"]');
  await expect(pendingPanel.locator("tbody tr").first()).toBeVisible({ timeout: 60_000 });
  await expect(pendingPanel.getByRole("columnheader", { name: "TP" })).toBeHidden({ timeout: 10_000 });
  await pendingPanel.locator("tbody tr").first().click();
  await expect(pendingPanel.getByText("Take Profit")).toBeVisible();
});
