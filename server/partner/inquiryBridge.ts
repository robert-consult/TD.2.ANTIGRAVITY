import { createMailboxThreadWithMessage } from "../services/messaging";

function trimBounded(value: unknown, maxLen: number): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function dedupePositiveInts(values: unknown[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type ForwardPartnerInquiryInput = {
  partnerId: number;
  partnerName: string;
  inboxAlias?: string | null;
  userHashId?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  subject: string;
  body: string;
  recipientAdminUserIds: number[];
  viewerAdminUserIds?: number[];
  e2eeEnvelope?: string | null;
  e2eeSenderKeyFingerprint?: string | null;
  bodyDigestSha256?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export async function forwardPartnerInquiryToAdmins(input: ForwardPartnerInquiryInput): Promise<{
  threadId: number;
  messageId: number;
  routeAdminRecipientIds: number[];
  viewerAdminRecipientIds: number[];
  participantRecipientIds: number[];
}> {
  const partnerId = Number(input.partnerId);
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new Error("INVALID_PARTNER_ID");
  }

  const partnerName = trimBounded(input.partnerName, 80) || `Partner-${partnerId}`;
  const inboxAlias = trimBounded(input.inboxAlias, 160) || "inquiries@";
  const userHashId = trimBounded(input.userHashId, 64) || null;
  const senderName = trimBounded(input.senderName, 120) || null;
  const senderEmail = trimBounded(input.senderEmail, 254) || null;
  const subject = trimBounded(input.subject, 160) || "Partner inquiry";
  const body = trimBounded(input.body, 8000);
  if (!body) {
    throw new Error("INQUIRY_BODY_REQUIRED");
  }

  const routeAdminRecipientIds = dedupePositiveInts(input.recipientAdminUserIds ?? []);
  if (!routeAdminRecipientIds.length) {
    throw new Error("NO_ADMIN_RECIPIENTS");
  }

  const viewerAdminRecipientIds = dedupePositiveInts(input.viewerAdminUserIds ?? []).filter(
    (id) => !routeAdminRecipientIds.includes(id),
  );
  const participantRecipientIds = dedupePositiveInts([...routeAdminRecipientIds, ...viewerAdminRecipientIds]);

  const e2eeEnvelope = trimBounded(input.e2eeEnvelope, 1_500_000) || undefined;
  const e2eeSenderKeyFingerprint = trimBounded(input.e2eeSenderKeyFingerprint, 64) || undefined;
  const bodyDigestSha256 = trimBounded(input.bodyDigestSha256, 64) || undefined;

  const decoratedSubject = `[PARTNER RFI][${inboxAlias}] ${partnerName} - ${subject}`;
  const messageBody = e2eeEnvelope
    ? "[Encrypted message]"
    : [
        `Mailbox: ${inboxAlias}`,
        `Partner: ${partnerName} (#${partnerId})`,
        userHashId ? `Trader: ${userHashId}` : "Trader: (not specified)",
        senderName ? `Sender: ${senderName}` : "Sender: (not provided)",
        senderEmail ? `Sender email: ${senderEmail}` : "Sender email: (not provided)",
        "",
        body,
      ].join("\n");

  const created = await createMailboxThreadWithMessage({
    createdByUserId: null,
    senderUserId: null,
    recipientUserIds: participantRecipientIds,
    subject: decoratedSubject,
    body: messageBody,
    allowReply: false,
    category: "SUPPORT",
    messageType: "PARTNER_RFI",
    metadata: {
      inboxAlias,
      partnerId,
      partnerName,
      userHashId,
      senderName,
      senderEmail,
      routeAdminRecipientIds,
      viewerAdminRecipientIds,
      source: "partner-portal",
      e2ee: Boolean(e2eeEnvelope),
    },
    e2eeEnvelope,
    e2eeSenderKeyFingerprint,
    bodyDigestSha256,
    audit: {
      actorUserId: null,
      actorRole: "SYSTEM",
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
    allowAsyncFanout: true,
  });

  return {
    threadId: created.threadId,
    messageId: created.messageId,
    routeAdminRecipientIds,
    viewerAdminRecipientIds,
    participantRecipientIds,
  };
}
