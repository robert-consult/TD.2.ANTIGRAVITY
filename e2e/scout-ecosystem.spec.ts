import { test, expect } from "@playwright/test";
import { acceptDoc1IfPrompted, login } from "./utils";

const ADMIN = { email: "admin@local.test", password: "changeme" };
const DEMO = { email: "demo@tradingfx.com", password: "demo1234" };

test("Recruitment ecosystem: scout APIs, challenge flow, and partner key auth", async ({ browser }) => {
  test.setTimeout(420_000);

  const baseURL = "http://127.0.0.1:5000";
  const adminContext = await browser.newContext({ baseURL });
  const traderContext = await browser.newContext({ baseURL });

  const adminPage = await adminContext.newPage();
  const traderPage = await traderContext.newPage();

  try {
    await login(adminPage, ADMIN.email, ADMIN.password);
    await acceptDoc1IfPrompted(adminPage);
    const mailboxKeyEnsure = await adminPage.evaluate(async () => {
      const existingRes = await fetch("/api/mailbox/e2ee/key", { credentials: "include" });
      const existingBody = await existingRes.json();
      if (existingRes.status < 400 && existingBody?.key?.fingerprint) {
        return { status: existingRes.status, body: existingBody, reused: true };
      }

      const toPem = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);
        const lines = b64.match(/.{1,64}/g) ?? [];
        return `-----BEGIN PUBLIC KEY-----\\n${lines.join("\\n")}\\n-----END PUBLIC KEY-----`;
      };
      const toHex = (buffer: ArrayBuffer) =>
        Array.from(new Uint8Array(buffer))
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");

      const keyPair = await crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"],
      );
      const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
      const publicKeyPem = toPem(spki);
      const fingerprint = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicKeyPem)));

      const putRes = await fetch("/api/mailbox/e2ee/key", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicKeyPem,
          keyAlgorithm: "RSA_OAEP_256_V1",
          fingerprint,
        }),
      });
      return { status: putRes.status, body: await putRes.json(), reused: false };
    });
    expect(mailboxKeyEnsure.status, JSON.stringify(mailboxKeyEnsure.body)).toBeLessThan(400);

    await adminPage.goto("/admin");
    await expect(adminPage.getByText("Admin Dashboard")).toBeVisible({ timeout: 60_000 });
    await adminPage.getByRole("tab", { name: "Scout" }).click();
    await expect(adminPage.getByTestId("admin-scout-workbench")).toBeVisible();

    const demoUserId = await adminPage.evaluate(async (email) => {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      const rows = await res.json();
      const hit = Array.isArray(rows)
        ? rows.find((u: any) => String(u?.email || "").toLowerCase() === String(email).toLowerCase())
        : null;
      return Number(hit?.id || 0);
    }, DEMO.email);
    expect(demoUserId).toBeGreaterThan(0);

    const watchlistUpsert = await adminPage.evaluate(async (userId) => {
      const res = await fetch("/api/admin/scout/watchlist", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, tier: "B_LIST", notes: "e2e scout validation" }),
      });
      return { status: res.status, body: await res.json() };
    }, demoUserId);
    expect(watchlistUpsert.status, JSON.stringify(watchlistUpsert.body)).toBeLessThan(400);

    const pipelineUpdate = await adminPage.evaluate(async (userId) => {
      const idempotencyKey = `e2e-scout-pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch(`/api/admin/scout/pipeline/${userId}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ stage: "WATCHLIST", isPartnerVisible: false }),
      });
      return { status: res.status, body: await res.json() };
    }, demoUserId);
    expect(pipelineUpdate.status, JSON.stringify(pipelineUpdate.body)).toBeLessThan(400);

    const watchlistRows = await adminPage.evaluate(async () => {
      const res = await fetch("/api/admin/scout/watchlist", { credentials: "include" });
      const body = await res.json();
      return { status: res.status, rows: body?.rows ?? [] };
    });
    expect(watchlistRows.status).toBe(200);
    expect(Array.isArray(watchlistRows.rows)).toBeTruthy();
    expect(watchlistRows.rows.some((r: any) => Number(r?.userId) === demoUserId)).toBeTruthy();

    const candidateDetail = await adminPage.evaluate(async (userId) => {
      const res = await fetch(`/api/admin/scout/candidates/${userId}`, { credentials: "include" });
      return { status: res.status, body: await res.json() };
    }, demoUserId);
    expect(candidateDetail.status, JSON.stringify(candidateDetail.body)).toBeLessThan(400);
    expect(Number(candidateDetail.body?.row?.userId || 0)).toBe(demoUserId);
    expect(Array.isArray(candidateDetail.body?.row?.attributionBySymbol)).toBeTruthy();

    const pipelineList = await adminPage.evaluate(async () => {
      const res = await fetch("/api/admin/scout/pipeline?limit=20", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(pipelineList.status, JSON.stringify(pipelineList.body)).toBeLessThan(400);
    expect(Array.isArray(pipelineList.body?.rows)).toBeTruthy();

    const configPatch = await adminPage.evaluate(async () => {
      const res = await fetch("/api/admin/scout/config", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scoutTabEnabled: true,
          partnerPortalEnabled: true,
          traderCompeteEnabled: true,
          traderProProfilesEnabled: true,
          traderCommunityEnabled: true,
          partnerAllocationsEnabled: true,
          partnerInviteDefaultExpiryDays: 90,
          leaderboardMode: "TOP_10",
        }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(configPatch.status, JSON.stringify(configPatch.body)).toBeLessThan(400);
    expect(Number(configPatch.body?.config?.partnerInviteDefaultExpiryDays || 0)).toBe(90);

    const mailboxConfigPatch = await adminPage.evaluate(async () => {
      const res = await fetch("/api/mailbox/admin/config", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messagingEnabled: true,
          messagingE2eeEnabled: true,
          messagingE2eeRequired: false,
        }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(mailboxConfigPatch.status, JSON.stringify(mailboxConfigPatch.body)).toBeLessThan(400);

    const inquiryRoutingPatch = await adminPage.evaluate(async (adminEmail) => {
      const res = await fetch("/api/admin/scout/inquiry-routing", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inboxAlias: "inquiries@",
          routeAdminEmails: [adminEmail],
          viewerAdminEmails: [],
        }),
      });
      return { status: res.status, body: await res.json() };
    }, ADMIN.email);
    expect(inquiryRoutingPatch.status, JSON.stringify(inquiryRoutingPatch.body)).toBeLessThan(400);

    const challengeCreate = await adminPage.evaluate(async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const payload = {
        name: `E2E Combine ${nowSec}`,
        description: "End-to-end challenge test",
        profitTargetPct: 0.05,
        maxDailyLossPct: 0.03,
        durationDays: 30,
        startAt: nowSec - 60,
        endAt: nowSec + 7 * 86400,
        isActive: true,
      };
      const res = await fetch("/api/admin/challenges", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(challengeCreate.status, JSON.stringify(challengeCreate.body)).toBeLessThan(400);
    const challengeId = Number(challengeCreate.body?.row?.id || 0);
    expect(challengeId).toBeGreaterThan(0);

    await login(traderPage, DEMO.email, DEMO.password);
    await acceptDoc1IfPrompted(traderPage);
    await traderPage.goto("/");
    await traderPage.getByRole("button", { name: /Leaders|Leaderboard/i }).first().click();
    await expect(traderPage.getByRole("tab", { name: "Leaderboard" })).toBeVisible();
    await expect(traderPage.getByRole("tab", { name: "My Resume" })).toBeVisible();
    await expect(traderPage.getByRole("tab", { name: "Compete" })).toBeVisible();
    await expect(traderPage.getByRole("tab", { name: "Community" })).toBeVisible();
    await expect(traderPage.getByText("My Rank:")).toBeVisible();

    const challengeList = await traderPage.evaluate(async () => {
      const res = await fetch("/api/trader/challenges", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(challengeList.status, JSON.stringify(challengeList.body)).toBeLessThan(400);
    const hasChallenge = (challengeList.body?.rows ?? []).some((r: any) => Number(r?.id) === challengeId);
    expect(hasChallenge).toBeTruthy();

    const enroll = await traderPage.evaluate(async (id) => {
      const res = await fetch(`/api/trader/challenges/${id}/enroll`, {
        method: "POST",
        credentials: "include",
      });
      return { status: res.status, body: await res.json() };
    }, challengeId);
    if (enroll.status >= 400) {
      expect(enroll.status).toBe(409);
      expect(String(enroll.body?.message || enroll.body?.code || "")).toBe("MAX_ACTIVE_ENROLLMENTS_USER_REACHED");
    } else {
      const enrollmentStatus = await traderPage.evaluate(async (id) => {
        const res = await fetch(`/api/trader/challenges/${id}/status`, {
          credentials: "include",
        });
        return { status: res.status, body: await res.json() };
      }, challengeId);
      expect(enrollmentStatus.status, JSON.stringify(enrollmentStatus.body)).toBeLessThan(400);
      expect(String(enrollmentStatus.body?.enrollment?.status || "")).toBe("ACTIVE");
    }

    const partnerCreate = await adminPage.evaluate(async () => {
      const idempotencyKey = `e2e-partner-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ name: `E2E Partner ${Date.now()}`, ipWhitelist: "" }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(partnerCreate.status, JSON.stringify(partnerCreate.body)).toBeLessThan(400);
    const apiKey = String(partnerCreate.body?.apiKey || "");
    const partnerId = Number(partnerCreate.body?.row?.id || 0);
    expect(apiKey.length).toBeGreaterThan(10);
    expect(partnerId).toBeGreaterThan(0);

    await adminPage.goto("/partner");
    await expect(adminPage.getByTestId("partner-portal-page")).toBeVisible();
    await adminPage.getByTestId("partner-key-input").fill(apiKey);
    await adminPage.getByTestId("partner-key-connect").click();
    const traderAccessTab = adminPage.getByRole("tab", { name: "Trader Access" });
    if ((await traderAccessTab.count()) > 0) {
      await traderAccessTab.first().click();
    }
    await expect(adminPage.getByTestId("partner-data-room-table")).toBeVisible();
    await adminPage.getByRole("tab", { name: "Simulations" }).click();
    await expect(adminPage.getByText("Run Simulation Preview")).toBeVisible();
    const allocationsTab = adminPage.getByRole("tab", { name: /^Allocations$/ }).last();
    await allocationsTab.scrollIntoViewIfNeeded();
    await allocationsTab.click({ timeout: 15000 });
    await expect(allocationsTab).toHaveAttribute("data-state", "active", { timeout: 15000 });
    await expect(adminPage.getByTestId("partner-allocations-table")).toBeVisible({ timeout: 45000 });

    const commsTab = adminPage.getByRole("tab", { name: /^Comms$/ }).last();
    await commsTab.scrollIntoViewIfNeeded();
    await commsTab.click({ timeout: 15000 });
    await expect(commsTab).toHaveAttribute("data-state", "active", { timeout: 15000 });
    await expect(adminPage.getByTestId("partner-inquiries-table")).toBeVisible({ timeout: 45000 });
    const inquiryCreate = await adminPage.evaluate(async (key) => {
      const recipientsRes = await fetch("/api/partner/inquiries/recipients", {
        credentials: "include",
        headers: { "x-partner-key": key },
      });
      const recipientsBody = await recipientsRes.json();
      if (recipientsRes.status >= 400) {
        return { status: recipientsRes.status, body: recipientsBody };
      }
      const rows = Array.isArray(recipientsBody?.rows) ? recipientsBody.rows : [];
      if (!rows.length) {
        return { status: 0, body: { message: "NO_RECIPIENT_ROWS" } };
      }
      if (Number(recipientsBody?.missingKeyCount || 0) > 0) {
        return {
          status: 0,
          body: { message: "INQUIRY_RECIPIENT_KEYS_MISSING", missingKeyCount: recipientsBody?.missingKeyCount },
        };
      }

      const recipients: Record<string, { keyAlgorithm: string; encryptedKey: string }> = {};
      for (const row of rows) {
        const userId = Number(row?.userId || 0);
        if (!Number.isInteger(userId) || userId <= 0) continue;
        recipients[String(userId)] = {
          keyAlgorithm: "RSA_OAEP_256_V1",
          encryptedKey: "A".repeat(128),
        };
      }

      const envelope = JSON.stringify({
        version: 1,
        keyAlgorithm: "RSA_OAEP_256_V1",
        dataAlgorithm: "AES_256_GCM",
        recipients,
        iv: "A".repeat(16),
        tag: "A".repeat(16),
        ciphertext: "AAAA",
        createdAt: Math.floor(Date.now() / 1000),
      });

      const createRes = await fetch("/api/partner/inquiries", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-partner-key": key,
        },
        body: JSON.stringify({
          senderName: "Partner Ops",
          senderEmail: "partner.ops@example.com",
          subject: "E2E partner inquiry",
          body: "Need allocation update details for candidate.",
          e2eeEnvelope: envelope,
          e2eeSenderKeyFingerprint: "a".repeat(64),
          bodyDigestSha256: "b".repeat(64),
        }),
      });
      return { status: createRes.status, body: await createRes.json() };
    }, apiKey);
    expect(inquiryCreate.status, JSON.stringify(inquiryCreate.body)).toBeLessThan(400);

    const partnerNoKey = await adminPage.evaluate(async () => {
      const res = await fetch("/api/partner/data-room", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(partnerNoKey.status).toBe(401);

    const partnerDataRoom = await adminPage.evaluate(async (key) => {
      const res = await fetch("/api/partner/data-room?limit=10", {
        credentials: "include",
        headers: { "x-partner-key": key },
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(partnerDataRoom.status, JSON.stringify(partnerDataRoom.body)).toBeLessThan(400);
    expect(Boolean(partnerDataRoom.body?.ok)).toBeTruthy();
    expect(Array.isArray(partnerDataRoom.body?.results)).toBeTruthy();

    const partnerInquiries = await adminPage.evaluate(async (key) => {
      const res = await fetch("/api/partner/inquiries?limit=20", {
        credentials: "include",
        headers: { "x-partner-key": key },
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(partnerInquiries.status, JSON.stringify(partnerInquiries.body)).toBeLessThan(400);
    expect((partnerInquiries.body?.rows ?? []).length).toBeGreaterThan(0);
    expect(String(partnerInquiries.body?.rows?.[0]?.senderEmail || "")).toBe("partner.ops@example.com");

    const hasPiiLeak = (partnerDataRoom.body?.results ?? []).some(
      (row: any) => row?.email !== undefined || row?.username !== undefined || row?.userId !== undefined,
    );
    expect(hasPiiLeak).toBeFalsy();

    const partnerDeactivate = await adminPage.evaluate(async (id) => {
      const res = await fetch(`/api/admin/partners/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      return { status: res.status, body: await res.json() };
    }, partnerId);
    expect(partnerDeactivate.status, JSON.stringify(partnerDeactivate.body)).toBeLessThan(400);

    const partnerAfterDeactivate = await adminPage.evaluate(async (key) => {
      const res = await fetch("/api/partner/data-room", {
        headers: { "x-partner-key": key },
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(partnerAfterDeactivate.status).toBe(401);
  } finally {
    await adminContext.close();
    await traderContext.close();
  }
});
