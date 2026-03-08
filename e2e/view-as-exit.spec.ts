import { test, expect } from "@playwright/test";
import { acceptDoc1IfPrompted, login } from "./utils";

const ADMIN = { email: "admin@local.test", password: "changeme" };

test("Admin can exit View As and returns to the admin session", async ({ browser }) => {
  test.setTimeout(120_000);

  const baseURL = "http://127.0.0.1:5000";
  const adminContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();

  try {
    await login(adminPage, ADMIN.email, ADMIN.password);
    await acceptDoc1IfPrompted(adminPage);
    await adminPage.goto("/");

    const impersonatedUser = await adminPage.evaluate(async () => {
      const issueCsrf = async () => {
        const response = await fetch("/api/csrf", { credentials: "include" });
        const payload = await response.json();
        return String(payload?.csrfToken ?? "");
      };

      const csrfToken = await issueCsrf();
      const usersResponse = await fetch("/api/admin/users", { credentials: "include" });
      const users = await usersResponse.json();
      const target = (users as any[]).find((user) => !user?.isAdmin && String(user?.email ?? "").includes("demo@tradingfx.com"));
      if (!target?.id) {
        throw new Error("Failed to resolve demo trader for View As test");
      }

      const startResponse = await fetch("/api/admin/view-as/start", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ userId: Number(target.id) }),
      });
      if (!startResponse.ok) {
        throw new Error(`View As start failed: ${startResponse.status} ${await startResponse.text()}`);
      }

      const currentUserResponse = await fetch("/api/auth/current-user", { credentials: "include" });
      return await currentUserResponse.json();
    });
    expect(impersonatedUser.isImpersonating).toBe(true);
    expect(impersonatedUser.isAdmin).toBe(false);
    expect(impersonatedUser.realAdminEmail).toBe(ADMIN.email);

    const restoredUser = await adminPage.evaluate(async () => {
      const issueCsrf = async () => {
        const response = await fetch("/api/csrf", { credentials: "include" });
        const payload = await response.json();
        return String(payload?.csrfToken ?? "");
      };

      const csrfToken = await issueCsrf();
      const stopResponse = await fetch("/api/admin/view-as/stop", {
        method: "POST",
        credentials: "include",
        headers: {
          "x-csrf-token": csrfToken,
        },
      });
      if (!stopResponse.ok) {
        throw new Error(`View As stop failed: ${stopResponse.status} ${await stopResponse.text()}`);
      }

      const currentUserResponse = await fetch("/api/auth/current-user", { credentials: "include" });
      return await currentUserResponse.json();
    });
    expect(restoredUser.isImpersonating).toBe(false);
    expect(restoredUser.isAdmin).toBe(true);
    expect(restoredUser.email).toBe(ADMIN.email);
  } finally {
    await adminContext.close().catch(() => undefined);
  }
});
