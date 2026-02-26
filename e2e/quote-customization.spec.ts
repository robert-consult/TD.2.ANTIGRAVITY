import { test, expect } from "@playwright/test";
import { login } from "./utils";

const DEMO = { email: "demo@tradingfx.com", password: "demo1234" };
const ADMIN = { email: "admin@local.test", password: "changeme" };

test("Quote customization: icon visibility + add/remove flow + admin withdrawal", async ({ browser }) => {
  const baseURL = "http://127.0.0.1:5000";
  const adminContext = await browser.newContext({ baseURL });
  const traderContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  const traderPage = await traderContext.newPage();

  let traderUserId = 0;
  let cleanupNeeded = false;

  try {
    await login(traderPage, DEMO.email, DEMO.password);
    await login(adminPage, ADMIN.email, ADMIN.password);

    const mePayload = await traderPage.evaluate(async () => {
      const response = await fetch("/api/quote-subscriptions/me", { credentials: "include" });
      return await response.json();
    });
    traderUserId = Number(mePayload?.userId ?? 0);
    expect(traderUserId).toBeGreaterThan(0);

    await adminPage.evaluate(async ({ userId }) => {
      const modeRes = await fetch(`/api/admin/quote-subscriptions/traders/${userId}/mode`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "BASIC_PLUS_CUSTOM" }),
      });
      if (!modeRes.ok) {
        throw new Error(`BASIC_PLUS_CUSTOM mode set failed: ${modeRes.status}`);
      }

      const subRes = await fetch(`/api/admin/quote-subscriptions/traders/${userId}/subscriptions`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbolIds: [] }),
      });
      if (!subRes.ok) {
        throw new Error(`Reset subscriptions failed: ${subRes.status}`);
      }
    }, { userId: traderUserId });
    cleanupNeeded = true;

    await expect
      .poll(async () => {
        return await traderPage.evaluate(async () => {
          const response = await fetch("/api/quote-subscriptions/me", { credentials: "include" });
          const payload = await response.json();
          return `${String(payload?.effectiveMode ?? "")}:${String(payload?.supportsCustom ?? "")}`;
        });
      })
      .toBe("BASIC_PLUS_CUSTOM:true");

    await traderPage.reload();
    await expect(traderPage.getByLabel("Add quote symbol")).toBeVisible();
    await expect(traderPage.getByLabel("Manage quote symbols")).toBeVisible();

    await traderPage.getByLabel("Add quote symbol").click();
    await expect(traderPage.getByRole("heading", { name: "Add Symbols" })).toBeVisible();
    await traderPage.getByRole("button", { name: "Cancel" }).click();

    await traderPage.getByLabel("Manage quote symbols").click();
    await expect(traderPage.getByRole("heading", { name: "Manage Symbols" })).toBeVisible();
    await traderPage.getByRole("button", { name: "Cancel" }).click();

    const overlapCount = await traderPage.evaluate(async () => {
      const [allowedRes, availableRes] = await Promise.all([
        fetch("/api/quote-subscriptions/allowed-symbols", { credentials: "include" }),
        fetch("/api/quote-subscriptions/available-symbols?limit=180&excludeAllowed=true", { credentials: "include" }),
      ]);
      const allowed = await allowedRes.json();
      const available = await availableRes.json();
      const allowedIds = new Set((allowed?.symbols ?? []).map((row: any) => Number(row.id)));
      return (available?.rows ?? []).filter((row: any) => allowedIds.has(Number(row.id))).length;
    });
    expect(overlapCount).toBe(0);

    const candidate = await traderPage.evaluate(async () => {
      const availableRes = await fetch("/api/quote-subscriptions/available-symbols?limit=180&excludeAllowed=true", {
        credentials: "include",
      });
      const available = await availableRes.json();
      const pick = (available?.rows ?? []).find((row: any) => Number(row.id) > 0);
      if (!pick) return null;
      return { id: Number(pick.id), symbol: String(pick.symbol) };
    });
    if (!candidate) {
      test.info().annotations.push({
        type: "note",
        description: "No optional symbols available beyond allowed set; skipping add/remove assertions",
      });
    } else {
      await traderPage.evaluate(async ({ symbolId }) => {
        const response = await fetch("/api/quote-subscriptions/me/subscriptions", {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbolIds: [symbolId] }),
        });
        if (!response.ok) {
          throw new Error(`Failed to save trader subscriptions: ${response.status}`);
        }
      }, { symbolId: candidate.id });

      await expect
        .poll(async () => {
          return await traderPage.evaluate(async ({ symbolId }) => {
            const response = await fetch("/api/quote-subscriptions/me/subscriptions", { credentials: "include" });
            const payload = await response.json();
            const rows = payload?.subscriptions ?? [];
            return rows.some((row: any) => Number(row.id) === symbolId);
          }, { symbolId: candidate.id });
        })
        .toBe(true);

      await traderPage.evaluate(async () => {
        const response = await fetch("/api/quote-subscriptions/me/subscriptions", {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbolIds: [] }),
        });
        if (!response.ok) {
          throw new Error(`Failed to clear trader subscriptions: ${response.status}`);
        }
      });

      await expect
        .poll(async () => {
          return await traderPage.evaluate(async () => {
            const response = await fetch("/api/quote-subscriptions/me/subscriptions", { credentials: "include" });
            const payload = await response.json();
            return Number(payload?.subscriptions?.length ?? 0);
          });
        })
        .toBe(0);
    }

    await adminPage.evaluate(async ({ userId }) => {
      const modeRes = await fetch(`/api/admin/quote-subscriptions/traders/${userId}/mode`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "BASIC_ONLY" }),
      });
      if (!modeRes.ok) {
        throw new Error(`Final BASIC_ONLY mode set failed: ${modeRes.status}`);
      }
    }, { userId: traderUserId });

    await expect
      .poll(async () => {
        return await traderPage.evaluate(async () => {
          const response = await fetch("/api/quote-subscriptions/me", { credentials: "include" });
          const payload = await response.json();
          return `${String(payload?.effectiveMode ?? "")}:${String(payload?.supportsCustom ?? "")}`;
        });
      })
      .toBe("BASIC_ONLY:false");
  } finally {
    if (cleanupNeeded && traderUserId > 0) {
      await adminPage.evaluate(async ({ userId }) => {
        const modeRes = await fetch(`/api/admin/quote-subscriptions/traders/${userId}/mode`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: null }),
        });
        if (!modeRes.ok) {
          throw new Error(`Cleanup mode reset failed: ${modeRes.status}`);
        }

        const subRes = await fetch(`/api/admin/quote-subscriptions/traders/${userId}/subscriptions`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbolIds: [] }),
        });
        if (!subRes.ok) {
          throw new Error(`Cleanup subscriptions reset failed: ${subRes.status}`);
        }
      }, { userId: traderUserId });
    }

    await adminContext.close();
    await traderContext.close();
  }
});
