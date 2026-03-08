import type { Request, Response, Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import {
  challengeCertificateTemplates,
  challengeCertificates,
  challenges,
  users,
} from "@shared/schema";
import {
  computeVerificationCodeHmac,
  parseVerificationCodeKeyId,
} from "../../recruitment/challengesV4/certificateCode";
import { renderChallengeCertificatePdf } from "../../recruitment/challengesV4/certificatePdf";
import { getSystemChallengeConfig } from "../../recruitment/challengesV4/challengeConfig";

type RecruitmentConfig = {
  challengeCertificatesDownloadable: boolean;
  challengeCertificatesEnabled: boolean;
  challengeCertificatesShareable: boolean;
  traderCompeteEnabled: boolean;
};

type CertificateRouteDeps = {
  nowSec: () => number;
  consumeChallengeRateLimit: (key: string, max: number, windowMs: number) => {
    allowed: boolean;
    retryAfterSec: number;
  };
  getRecruitmentConfig: () => Promise<RecruitmentConfig>;
  toTraderCertificateRow: (cert: Record<string, unknown>) => Record<string, unknown>;
};

const certificateIdSchema = z.object({ id: z.coerce.number().int().positive() });

async function getOwnedCertificateBundle(
  userId: number,
  certificateId: number,
  toTraderCertificateRow: CertificateRouteDeps["toTraderCertificateRow"],
) {
  const [cert] = await db
    .select({
      id: challengeCertificates.id,
      userId: challengeCertificates.userId,
      challengeId: challengeCertificates.challengeId,
      enrollmentId: challengeCertificates.enrollmentId,
      templateId: challengeCertificates.templateId,
      issuedAt: challengeCertificates.issuedAt,
      isDownloadable: challengeCertificates.isDownloadable,
      isShareable: challengeCertificates.isShareable,
      shareTokenHash: challengeCertificates.shareTokenHash,
      verificationCodeNonce: challengeCertificates.verificationCodeNonce,
      verificationHmacKeyId: challengeCertificates.verificationHmacKeyId,
      verificationCodeHmac: challengeCertificates.verificationCodeHmac,
      metricsJson: challengeCertificates.metricsJson,
      downloadedAt: challengeCertificates.downloadedAt,
    })
    .from(challengeCertificates)
    .where(eq(challengeCertificates.id, certificateId))
    .limit(1);

  if (!cert || cert.userId !== userId) return null;

  const [tmpl] = cert.templateId
    ? await db
        .select({
          id: challengeCertificateTemplates.id,
          name: challengeCertificateTemplates.name,
          headerText: challengeCertificateTemplates.headerText,
          bodyText: challengeCertificateTemplates.bodyText,
          includeMetrics: challengeCertificateTemplates.includeMetrics,
          includeVerificationCode: challengeCertificateTemplates.includeVerificationCode,
          brandColor: challengeCertificateTemplates.brandColor,
          logoUrl: challengeCertificateTemplates.logoUrl,
        })
        .from(challengeCertificateTemplates)
        .where(eq(challengeCertificateTemplates.id, cert.templateId))
        .limit(1)
    : [];

  const [challenge] = await db
    .select({
      id: challenges.id,
      name: challenges.name,
      slug: challenges.slug,
    })
    .from(challenges)
    .where(eq(challenges.id, cert.challengeId))
    .limit(1);

  return {
    cert: toTraderCertificateRow(cert as Record<string, unknown>),
    tmpl: (tmpl ?? null) as Record<string, unknown> | null,
    challenge: (challenge ?? null) as Record<string, unknown> | null,
  };
}

export function registerTraderTalentCertificateRoutes(
  router: Router,
  publicRouter: Router,
  deps: CertificateRouteDeps,
) {
  const { consumeChallengeRateLimit, getRecruitmentConfig, nowSec, toTraderCertificateRow } = deps;

  async function handleCertificateDetail(req: Request, res: Response) {
    try {
      const cfg = await getRecruitmentConfig();
      if (!cfg.traderCompeteEnabled) return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
      if (!cfg.challengeCertificatesEnabled) return res.status(403).json({ message: "CERTIFICATES_DISABLED" });

      const userId = Number((req as any).session?.userId || 0);
      const parsed = certificateIdSchema.safeParse({ id: req.params.id });
      if (!parsed.success) return res.status(400).json({ message: "INVALID_CERTIFICATE_ID" });

      const bundle = await getOwnedCertificateBundle(userId, parsed.data.id, toTraderCertificateRow);
      if (!bundle) return res.status(404).json({ message: "CERTIFICATE_NOT_FOUND" });

      return res.json({ ok: true, certificate: bundle.cert, template: bundle.tmpl, challenge: bundle.challenge });
    } catch (error) {
      console.error("[trader-talent] certificate get error:", error);
      return res.status(500).json({ message: "FAILED_TO_FETCH_CERTIFICATE" });
    }
  }

  router.get("/challenges/certificates/:id", handleCertificateDetail);
  router.get("/challenges/certificate/:id", handleCertificateDetail);

  router.get("/challenges/certificate/:id/download", async (req: Request, res: Response) => {
    try {
      const cfg = await getRecruitmentConfig();
      const challengeCfg = await getSystemChallengeConfig();
      if (!cfg.traderCompeteEnabled) return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
      if (!cfg.challengeCertificatesEnabled) return res.status(403).json({ message: "CERTIFICATES_DISABLED" });
      if (!cfg.challengeCertificatesDownloadable) return res.status(403).json({ message: "CERTIFICATE_DOWNLOAD_DISABLED" });

      const userId = Number((req as any).session?.userId || 0);
      const parsed = certificateIdSchema.safeParse({ id: req.params.id });
      if (!parsed.success) return res.status(400).json({ message: "INVALID_CERTIFICATE_ID" });

      const bundle = await getOwnedCertificateBundle(userId, parsed.data.id, toTraderCertificateRow);
      if (!bundle) return res.status(404).json({ message: "CERTIFICATE_NOT_FOUND" });
      if (!Boolean(bundle.cert.isDownloadable)) return res.status(403).json({ message: "CERTIFICATE_NOT_DOWNLOADABLE" });

      const certificateId = Number(bundle.cert.id || 0);
      const issuedAt = Number(bundle.cert.issuedAt || 0);
      const verificationCode = String(bundle.cert.verificationCode ?? "");
      const metricsJson = String(bundle.cert.metricsJson ?? "{}");

      await db
        .update(challengeCertificates)
        .set({ downloadedAt: nowSec() })
        .where(eq(challengeCertificates.id, certificateId));

      let parsedMetrics: Record<string, unknown> = {};
      try {
        parsedMetrics = JSON.parse(metricsJson) as Record<string, unknown>;
      } catch {}

      const issuedIso = new Date(issuedAt * 1000).toISOString();
      const bodyText = String(bundle.tmpl?.bodyText ?? "")
        .replaceAll("{{challenge_name}}", String(bundle.challenge?.name ?? "Challenge"))
        .replaceAll("{{completion_date}}", issuedIso.split("T")[0] || issuedIso)
        .replaceAll("{{certificate_id}}", String(certificateId))
        .replaceAll("{{verification_code}}", verificationCode);
      const verificationUrl = `${req.protocol}://${req.get("host")}/api/public/trader/challenges/certificate/${encodeURIComponent(
        verificationCode,
      )}/verify`;
      const includeVerificationCode = bundle.tmpl?.includeVerificationCode !== false;
      const includeMetrics = bundle.tmpl?.includeMetrics !== false;
      const includeQr =
        Boolean(challengeCfg.challengeCertificateIncludeQrDefault) &&
        Boolean(bundle.cert.isShareable) &&
        includeVerificationCode;

      const pdf = renderChallengeCertificatePdf({
        certificateId,
        challengeName: String(bundle.challenge?.name ?? "Unknown Challenge"),
        templateName: String(bundle.tmpl?.name ?? "Default"),
        headerText: String(bundle.tmpl?.headerText || "Completion Certificate"),
        bodyText: bodyText || "This certifies successful completion of the challenge assessment.",
        issuedIso,
        brandColor: bundle.tmpl?.brandColor == null ? null : String(bundle.tmpl.brandColor),
        logoUrl: bundle.tmpl?.logoUrl == null ? null : String(bundle.tmpl.logoUrl),
        includeMetrics,
        includeVerificationCode,
        includeQr,
        verificationCode,
        verificationUrl,
        metrics: parsedMetrics,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=\"challenge-certificate-${certificateId}.pdf\"`);
      res.setHeader("Content-Length", String(pdf.byteLength));
      return res.status(200).send(pdf);
    } catch (error) {
      console.error("[trader-talent] certificate download error:", error);
      return res.status(500).json({ message: "FAILED_TO_DOWNLOAD_CERTIFICATE" });
    }
  });

  async function handleCertificateVerify(req: Request, res: Response) {
    try {
      const cfg = await getRecruitmentConfig();
      if (!cfg.challengeCertificatesEnabled) return res.status(403).json({ message: "CERTIFICATES_DISABLED" });
      if (!cfg.challengeCertificatesShareable) return res.status(403).json({ message: "CERTIFICATE_SHARE_DISABLED" });

      const rate = consumeChallengeRateLimit(`challenge-cert-verify:${req.ip}`, 60, 60_000);
      if (!rate.allowed) {
        res.setHeader("Retry-After", String(rate.retryAfterSec));
        return res.status(429).json({
          message: "RATE_LIMITED",
          code: "CHALLENGE_CERT_VERIFY_RATE_LIMIT",
          retryAfterSec: rate.retryAfterSec,
        });
      }

      const legacyCode = String(req.params.code || req.params.verificationCode || "").trim();
      const code = legacyCode.toUpperCase();
      if (!legacyCode || legacyCode.length < 16) return res.status(400).json({ message: "INVALID_CODE" });

      const certSelect = {
        id: challengeCertificates.id,
        userId: challengeCertificates.userId,
        challengeId: challengeCertificates.challengeId,
        enrollmentId: challengeCertificates.enrollmentId,
        templateId: challengeCertificates.templateId,
        issuedAt: challengeCertificates.issuedAt,
        isShareable: challengeCertificates.isShareable,
        verificationCodeNonce: challengeCertificates.verificationCodeNonce,
        verificationHmacKeyId: challengeCertificates.verificationHmacKeyId,
        verificationCodeHmac: challengeCertificates.verificationCodeHmac,
        metricsJson: challengeCertificates.metricsJson,
      } as const;

      let cert: Record<string, unknown> | null = null;
      const keyId = parseVerificationCodeKeyId(code);
      if (keyId) {
        const codeHmac = computeVerificationCodeHmac(code, keyId);
        const [row] = await db
          .select(certSelect)
          .from(challengeCertificates)
          .where(and(eq(challengeCertificates.verificationCodeHmac, codeHmac), eq(challengeCertificates.verificationHmacKeyId, keyId)))
          .limit(1);
        cert = (row as Record<string, unknown> | undefined) ?? null;
      }

      if (!cert) {
        const [legacyRow] = await db
          .select(certSelect)
          .from(challengeCertificates)
          .where(eq(challengeCertificates.verificationCodeHmac, legacyCode))
          .limit(1);
        cert = (legacyRow as Record<string, unknown> | undefined) ?? null;
      }

      if (!cert || !Boolean(cert.isShareable)) return res.status(404).json({ message: "NOT_FOUND" });

      const publicCert = toTraderCertificateRow(cert);
      const [user] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, Number(cert.userId || 0)))
        .limit(1);
      const [challenge] = await db
        .select({ name: challenges.name })
        .from(challenges)
        .where(eq(challenges.id, Number(cert.challengeId || 0)))
        .limit(1);

      return res.json({
        ok: true,
        certificate: {
          id: Number(cert.id || 0),
          issuedAt: Number(cert.issuedAt || 0),
          challengeId: Number(cert.challengeId || 0),
          challengeName: challenge?.name ?? null,
          userId: Number(cert.userId || 0),
          username: user?.username ?? null,
          verificationCode: String(publicCert.verificationCode ?? code),
          metricsJson: cert.metricsJson ?? null,
        },
      });
    } catch (error) {
      console.error("[trader-talent] certificate verify error:", error);
      return res.status(500).json({ message: "FAILED_TO_VERIFY_CERT" });
    }
  }

  publicRouter.get("/challenges/certificates/verify/:code", handleCertificateVerify);
  publicRouter.get("/challenges/certificate/:verificationCode/verify", handleCertificateVerify);
}
