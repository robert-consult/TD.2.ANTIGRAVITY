import { expect, test } from "@playwright/test";
import { acceptDoc1IfPrompted, login } from "./utils";

const ADMIN = { email: "admin@local.test", password: "changeme" };

test("Partner invite-first onboarding enforces gates and transitions to approved", async ({ browser }) => {
  test.setTimeout(420_000);

  const baseURL = "http://127.0.0.1:5000";
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    await login(page, ADMIN.email, ADMIN.password);
    await acceptDoc1IfPrompted(page);

    const mailboxKeyEnsure = await page.evaluate(async () => {
      const existingRes = await fetch("/api/mailbox/e2ee/key", { credentials: "include" });
      const existingBody = await existingRes.json();
      if (existingRes.status < 400 && existingBody?.key?.fingerprint) {
        return { status: existingRes.status, body: existingBody };
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
      return { status: putRes.status, body: await putRes.json() };
    });
    expect(mailboxKeyEnsure.status, JSON.stringify(mailboxKeyEnsure.body)).toBeLessThan(400);

    const configPatch = await page.evaluate(async () => {
      const res = await fetch("/api/admin/scout/config", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scoutTabEnabled: true,
          partnerPortalEnabled: true,
          partnerAllocationsEnabled: true,
          partnerGatingConfig: {
            viewDataRoom: "INVITED",
            runSimulations: "IDENTITY",
            requestAllocation: "COMPLIANT",
            directContact: "ADMIN_APPROVED",
          },
          partnerInviteDefaultExpiryDays: 7,
          partnerPasswordRotationDays: 90,
          partnerPasswordReminderLogins: 3,
        }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(configPatch.status, JSON.stringify(configPatch.body)).toBeLessThan(400);

    const mailboxConfigPatch = await page.evaluate(async () => {
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

    const routingPatch = await page.evaluate(async (adminEmail) => {
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
    expect(routingPatch.status, JSON.stringify(routingPatch.body)).toBeLessThan(400);

    const inviteEmail = `partner.onboard.${Date.now()}@example.com`;
    const invite = await page.evaluate(async (email) => {
      const res = await fetch("/api/admin/partners/invite", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          fundName: "BlueWater Capital LLC",
          adminNotes: "E2E onboarding flow",
          expiresInDays: 7,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, inviteEmail);
    expect(invite.status, JSON.stringify(invite.body)).toBeLessThan(400);
    const partnerId = Number(invite.body?.row?.id || 0);
    const apiKey = String(invite.body?.credentials?.apiKey || "");
    expect(partnerId).toBeGreaterThan(0);
    expect(apiKey.length).toBeGreaterThan(12);

    const initialState = await page.evaluate(async (key) => {
      const res = await fetch("/api/partner/onboarding/state", {
        credentials: "include",
        headers: { "x-partner-key": key },
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(initialState.status, JSON.stringify(initialState.body)).toBeLessThan(400);
    expect(String(initialState.body?.state?.onboardingStep || "")).toBe("PROFILE");
    expect(Boolean(initialState.body?.state?.gates?.viewDataRoom)).toBeTruthy();
    expect(Boolean(initialState.body?.state?.gates?.requestAllocation)).toBeFalsy();

    const simHashId = "User-SIM-E2E-UNKNOWN";

    const blockedSimulationAtProfile = await page.evaluate(async (payload) => {
      const { key, userHashId } = payload as { key: string; userHashId: string };
      const res = await fetch("/api/partner/simulations/preview", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-partner-key": key },
        body: JSON.stringify({
          userHashId,
          notionalUsd: 100000,
          horizonDays: 30,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { key: apiKey, userHashId: simHashId });
    expect(blockedSimulationAtProfile.status).toBe(403);
    expect(String(blockedSimulationAtProfile.body?.message || "")).toBe("PARTNER_GATE_BLOCKED");

    const blockedAllocations = await page.evaluate(async (key) => {
      const res = await fetch("/api/partner/allocations?limit=5", {
        credentials: "include",
        headers: { "x-partner-key": key },
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(blockedAllocations.status).toBe(403);
    expect(String(blockedAllocations.body?.message || "")).toBe("PARTNER_GATE_BLOCKED");

    const profileUpdate = await page.evaluate(async (key) => {
      const res = await fetch("/api/partner/onboarding/profile", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-partner-key": key },
        body: JSON.stringify({
          fundName: "BlueWater Capital LLC",
          aumRange: "$10M-$50M",
          hqLocation: "New York, USA",
          strategyTags: ["L/S Equity", "Quant", "Crypto"],
          institutionProfile: {
            legalEntityName: "BlueWater Capital Management LLC",
            tradingName: "BlueWater Capital",
            entityType: "HEDGE_FUND",
            domicileCountryIso2: "US",
            incorporationCountryIso2: "US",
            registrationCountriesIso2: ["US", "CA"],
            websiteUrl: "https://bluewater.example.test",
            socialProfiles: ["https://www.linkedin.com/company/bluewater"],
            businessDescription: "Multi-strategy absolute return manager",
            baseCurrency: "USD",
            primaryTimezone: "America/New_York",
            generalEmails: ["ops@bluewater.example.test", "compliance@bluewater.example.test"],
            phoneNumbers: [
              {
                label: "Main desk",
                countryIso2: "US",
                numberE164: "+12125550101",
                extension: "101",
              },
            ],
            faxNumbers: [
              {
                label: "Ops fax",
                countryIso2: "US",
                numberE164: "+12125550199",
              },
            ],
            addresses: [
              {
                kind: "HEAD_OFFICE",
                line1: "1 Liberty Plaza",
                city: "New York",
                stateRegion: "NY",
                postalCode: "10006",
                countryIso2: "US",
              },
            ],
            pointsOfContact: [
              {
                fullName: "Jane Operator",
                title: "Head of Operations",
                department: "Operations",
                email: "jane.operator@bluewater.example.test",
                location: "New York, US",
                preferredChannel: "EMAIL",
                isPrimary: true,
                phone: {
                  label: "Direct",
                  countryIso2: "US",
                  numberE164: "+12125550123",
                },
                fax: {
                  label: "Fax",
                  countryIso2: "US",
                  numberE164: "+12125550177",
                },
              },
            ],
            serviceProviders: {
              primeBroker: "Prime XYZ",
              fundAdministrator: "Admin ABC",
              auditor: "Audit LLP",
              custodian: "Custody Co",
              legalCounsel: "Counsel Partners",
              bankingPartner: "Bank 123",
            },
            regulatory: {
              regulatorNames: ["SEC", "CFTC"],
              secFileNumber: "801-12345",
              secExemptFileNumber: "802-54321",
              crdNumber: "123456",
              cikNumbers: ["0001234567"],
              nfaId: "NFA12345",
              registrationNumber: "REG-7788",
              taxId: "12-3456789",
              lei: "529900T8BM49AURSDO55",
            },
            operations: {
              inceptionYear: 2019,
              employeeCountRange: "26-50",
              businessDays: "Mon-Fri",
              businessHours: "09:00-17:00 ET",
            },
          },
        }),
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(profileUpdate.status, JSON.stringify(profileUpdate.body)).toBeLessThan(400);
    expect(String(profileUpdate.body?.state?.onboardingStep || "")).toBe("IDENTITY");
    expect(
      String(profileUpdate.body?.state?.profileData?.institutionProfile?.legalEntityName || ""),
    ).toBe("BlueWater Capital Management LLC");
    expect(
      Number(profileUpdate.body?.state?.profileData?.institutionProfile?.pointsOfContact?.length || 0),
    ).toBeGreaterThanOrEqual(1);

    const simulationAfterIdentity = await page.evaluate(async (payload) => {
      const { key, userHashId } = payload as { key: string; userHashId: string };
      const res = await fetch("/api/partner/simulations/preview", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-partner-key": key },
        body: JSON.stringify({
          userHashId,
          notionalUsd: 100000,
          horizonDays: 30,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { key: apiKey, userHashId: simHashId });
    expect(simulationAfterIdentity.status).toBe(404);
    expect(String(simulationAfterIdentity.body?.message || "")).toBe("CANDIDATE_NOT_FOUND");

    const tightenSimulationGate = await page.evaluate(async (id) => {
      const res = await fetch(`/api/admin/partners/${id}/gating-overrides`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runSimulations: "ADMIN_APPROVED",
          viewDataRoom: "INVITED",
          requestAllocation: "COMPLIANT",
          directContact: "ADMIN_APPROVED",
        }),
      });
      return { status: res.status, body: await res.json() };
    }, partnerId);
    expect(tightenSimulationGate.status, JSON.stringify(tightenSimulationGate.body)).toBeLessThan(400);

    const blockedSimulationAfterOverride = await page.evaluate(async (payload) => {
      const { key, userHashId } = payload as { key: string; userHashId: string };
      const res = await fetch("/api/partner/simulations/preview", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-partner-key": key },
        body: JSON.stringify({
          userHashId,
          notionalUsd: 100000,
          horizonDays: 30,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { key: apiKey, userHashId: simHashId });
    expect(blockedSimulationAfterOverride.status).toBe(403);
    expect(String(blockedSimulationAfterOverride.body?.message || "")).toBe("PARTNER_GATE_BLOCKED");

    const relaxSimulationGate = await page.evaluate(async (id) => {
      const res = await fetch(`/api/admin/partners/${id}/gating-overrides`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runSimulations: "IDENTITY",
          viewDataRoom: "INVITED",
          requestAllocation: "COMPLIANT",
          directContact: "ADMIN_APPROVED",
        }),
      });
      return { status: res.status, body: await res.json() };
    }, partnerId);
    expect(relaxSimulationGate.status, JSON.stringify(relaxSimulationGate.body)).toBeLessThan(400);

    const simulationAfterRelax = await page.evaluate(async (payload) => {
      const { key, userHashId } = payload as { key: string; userHashId: string };
      const res = await fetch("/api/partner/simulations/preview", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-partner-key": key },
        body: JSON.stringify({
          userHashId,
          notionalUsd: 100000,
          horizonDays: 30,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { key: apiKey, userHashId: simHashId });
    expect(simulationAfterRelax.status).toBe(404);
    expect(String(simulationAfterRelax.body?.message || "")).toBe("CANDIDATE_NOT_FOUND");

    const legalUpdate = await page.evaluate(async (key) => {
      const res = await fetch("/api/partner/onboarding/legal", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-partner-key": key },
        body: JSON.stringify({
          kybDocUrl: "https://files.example.test/kyb/bluewater-coi.pdf",
          agreedToAllocation: true,
          agreedToNda: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(legalUpdate.status, JSON.stringify(legalUpdate.body)).toBeLessThan(400);
    expect(String(legalUpdate.body?.state?.onboardingStep || "")).toBe("WAITING_APPROVAL");
    expect(Boolean(legalUpdate.body?.state?.gates?.requestAllocation)).toBeTruthy();
    expect(Boolean(legalUpdate.body?.state?.gates?.directContact)).toBeFalsy();

    const recipients = await page.evaluate(async (key) => {
      const res = await fetch("/api/partner/inquiries/recipients", {
        credentials: "include",
        headers: { "x-partner-key": key },
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(recipients.status, JSON.stringify(recipients.body)).toBeLessThan(400);
    expect(Number(recipients.body?.missingKeyCount || 0)).toBe(0);

    const inquiryCreate = await page.evaluate(async (key) => {
      const recipientsRes = await fetch("/api/partner/inquiries/recipients", {
        credentials: "include",
        headers: { "x-partner-key": key },
      });
      const recipientsBody = await recipientsRes.json();
      if (recipientsRes.status >= 400) {
        return { status: recipientsRes.status, body: recipientsBody };
      }
      const rows = Array.isArray(recipientsBody?.rows) ? recipientsBody.rows : [];
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
      const res = await fetch("/api/partner/inquiries", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-partner-key": key },
        body: JSON.stringify({
          senderName: "BlueWater Ops",
          senderEmail: "ops@bluewater.example.com",
          subject: "Requesting trader contact workflow",
          body: "Please review and approve direct contact access.",
          e2eeEnvelope: envelope,
          bodyDigestSha256: "b".repeat(64),
        }),
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(inquiryCreate.status, JSON.stringify(inquiryCreate.body)).toBeLessThan(400);

    const approval = await page.evaluate(async (id) => {
      const res = await fetch(`/api/admin/partners/${id}/approve`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", adminNotes: "E2E approved" }),
      });
      return { status: res.status, body: await res.json() };
    }, partnerId);
    expect(approval.status, JSON.stringify(approval.body)).toBeLessThan(400);

    const finalState = await page.evaluate(async (key) => {
      const res = await fetch("/api/partner/onboarding/state", {
        credentials: "include",
        headers: { "x-partner-key": key },
      });
      return { status: res.status, body: await res.json() };
    }, apiKey);
    expect(finalState.status, JSON.stringify(finalState.body)).toBeLessThan(400);
    expect(String(finalState.body?.state?.onboardingStep || "")).toBe("COMPLETED");
    expect(Boolean(finalState.body?.state?.gates?.directContact)).toBeTruthy();
  } finally {
    await context.close();
  }
});
