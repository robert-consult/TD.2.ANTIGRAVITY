import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import {
  decryptMailboxEnvelopeForUser,
  ensureMailboxE2eeKey,
  getStoredMailboxE2eeKey,
} from "@/lib/e2ee";

export type MailboxThreadRow = {
  threadId: number;
  subject: string;
  category: string;
  isBroadcast: boolean;
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
  lastReadMessageId: number | null;
  latestMessageId: number;
  latestBody: string;
  latestContentFormat?: "PLAINTEXT" | "MARKDOWN" | string;
  latestCreatedAt: number;
  latestSenderId: number | null;
  latestAllowReply: boolean;
  latestSenderEmail: string | null;
  latestSenderUsername: string | null;
  hasUnread: boolean;
  unreadUserReplyCount?: number;
  latestUserReplyAt?: number | null;
};

export type MailboxMessageRow = {
  id: number;
  threadId: number;
  senderId: number | null;
  body: string;
  bodyEncoding?: string;
  contentFormat?: "PLAINTEXT" | "MARKDOWN" | string;
  e2eeEnvelope?: string | null;
  e2eeSenderKeyFingerprint?: string | null;
  createdAt: number;
  allowReply: boolean;
  messageType: string;
  metadata: string | null;
  senderUsername: string | null;
  senderEmail: string | null;
  senderIsAdmin: boolean | null;
};

export type MailboxThreadParticipant = {
  userId: number;
  email: string | null;
  username: string | null;
  isAdmin: boolean;
  mailboxPublicKey: string | null;
  mailboxPublicKeyAlgo: string | null;
  mailboxPublicKeyFingerprint: string | null;
  mailboxPublicKeyUpdatedAt: number | null;
  lastReadMessageId: number | null;
};

export type MailboxThreadDetail = {
  thread: {
    threadId: number;
    subject: string;
    category: string;
    isBroadcast: boolean;
    createdAt: number;
    updatedAt: number;
  };
  messages: MailboxMessageRow[];
  participants?: MailboxThreadParticipant[];
};

type MailboxThreadsPayload = {
  rows: MailboxThreadRow[];
  unreadCount: number;
};

export type MailboxClientConfig = {
  messagingEnabled: boolean;
  messagingAllowReplyByDefault: boolean;
  messagingE2eeEnabled: boolean;
  messagingE2eeRequired: boolean;
  updatedAt: number;
};

export type CommunicationSettingsRow = {
  id: number;
  messagingEnabled: boolean;
  messagingAllowReplyByDefault: boolean;
  messagingAllowBroadcastReplies: boolean;
  messagingLargeTargetThreshold: number;
  messagingMaxRecipientsPerSend: number;
  messagingAsyncFanoutThreshold: number;
  messagingFanoutBatchSize: number;
  messagingAutoWelcomeEnabled: boolean;
  messagingAccountStatusMailboxEnabled: boolean;
  messagingKycMailboxEnabled: boolean;
  messagingE2eeEnabled: boolean;
  messagingE2eeRequired: boolean;
  notificationsEnabled: boolean;
  notificationRealtimeEnabled: boolean;
  notificationSoundDefaultEnabled: boolean;
  notificationE2eeEnabled: boolean;
  notificationE2eeRequired: boolean;
  notificationTradePendingFillEnabled: boolean;
  notificationTradeTakeProfitEnabled: boolean;
  notificationTradeStopLossEnabled: boolean;
  notificationTradeMaxHoldEnabled: boolean;
  notificationAccountFreezeEnabled: boolean;
  notificationAccountUnfreezeEnabled: boolean;
  notificationKycUpdatesEnabled: boolean;
  updatedAt: number;
  updatedBy: string | null;
};

export type CommunicationSettingsPatchPayload = Partial<
  Omit<CommunicationSettingsRow, "id" | "updatedAt" | "updatedBy">
>;

export type MailboxE2eeKeyPayload = {
  userId: number;
  key: {
    publicKeyPem: string;
    keyAlgorithm: string;
    fingerprint: string;
    updatedAt: number | null;
  } | null;
};

export type MailboxResolvedRecipientsPayload = {
  recipientCount: number;
  keyCount: number;
  missingKeyCount: number;
  missingKeyUserIds: number[];
  rows: Array<{
    id: number;
    email: string | null;
    username: string | null;
    userTier: string | null;
    mailboxPublicKey: string;
    mailboxPublicKeyAlgo: string | null;
    mailboxPublicKeyFingerprint: string | null;
  }>;
};

function isMessageForCurrentUser(message: any, userId: number | undefined): boolean {
  if (!userId) return false;
  const eventUserId = Number(message?.userId ?? 0);
  return !eventUserId || eventUserId === userId;
}

async function decryptThreadMessagesForUser(
  messages: MailboxMessageRow[],
  userId: number | undefined,
): Promise<MailboxMessageRow[]> {
  if (!userId || !messages.length) return messages;
  const localKey = getStoredMailboxE2eeKey(userId);
  if (!localKey?.privateKeyJwk) return messages;

  const next = await Promise.all(
    messages.map(async (message) => {
      if (message.bodyEncoding !== "E2EE_ENVELOPE_V1" || !message.e2eeEnvelope) {
        return message;
      }

      const decrypted = await decryptMailboxEnvelopeForUser({
        envelopeJson: message.e2eeEnvelope,
        userId,
        privateKeyJwk: localKey.privateKeyJwk,
      });

      if (!decrypted) return message;
      return {
        ...message,
        body: decrypted,
      };
    }),
  );

  return next;
}

export function useMailboxLiveSync() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { subscribe } = useLiveUpdates();

  useEffect(() => {
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (!isMessageForCurrentUser(message, user?.id)) return;

      if (message.type === "mailbox:new" || message.type === "mailbox:updated") {
        queryClient.invalidateQueries({ queryKey: ["mailbox"] });
        return;
      }

      if (message.type === "communications:config-updated") {
        queryClient.invalidateQueries({ queryKey: ["mailbox", "admin", "config"] });
        queryClient.invalidateQueries({ queryKey: ["mailbox", "config"] });
        queryClient.invalidateQueries({ queryKey: ["notifications", "config"] });
      }
    });
  }, [queryClient, subscribe, user?.id]);
}

export function useMailboxE2eeBootstrap() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const bootstrapRef = useRef<number | null>(null);

  useEffect(() => {
    const userId = Number(user?.id ?? 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      bootstrapRef.current = null;
      return;
    }
    if (bootstrapRef.current === userId) return;

    bootstrapRef.current = userId;
    let cancelled = false;

    void (async () => {
      try {
        const localKey = await ensureMailboxE2eeKey(userId);
        if (cancelled) return;

        const res = await apiRequest("GET", "/api/mailbox/e2ee/key");
        const payload = (await res.json()) as MailboxE2eeKeyPayload;
        const serverFingerprint = payload?.key?.fingerprint ?? null;

        if (!payload?.key || serverFingerprint !== localKey.fingerprint) {
          await apiRequest("PUT", "/api/mailbox/e2ee/key", {
            publicKeyPem: localKey.publicKeyPem,
            keyAlgorithm: localKey.keyAlgorithm,
            fingerprint: localKey.fingerprint,
          });
          queryClient.invalidateQueries({ queryKey: ["mailbox", "e2ee", "key"] });
        }

        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        queryClient.invalidateQueries({ queryKey: ["mailbox", "thread"] });
      } catch (error) {
        console.error("[mailbox] e2ee bootstrap failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queryClient, user?.id]);
}

export function useMailboxThreads(limit = 30, offset = 0) {
  const { user } = useAuth();
  return useQuery<MailboxThreadsPayload>({
    queryKey: ["mailbox", "threads", limit, offset],
    enabled: !!user,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/mailbox?limit=${Math.max(1, Math.min(100, limit))}&offset=${Math.max(0, offset)}`,
      );
      return res.json();
    },
  });
}

export function useMailboxThread(threadId: number | null, limit = 120) {
  const { user } = useAuth();
  return useQuery<MailboxThreadDetail>({
    queryKey: ["mailbox", "thread", threadId, limit, user?.id],
    enabled: !!user && !!threadId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mailbox/${threadId}?limit=${Math.max(1, Math.min(200, limit))}`);
      const payload = (await res.json()) as MailboxThreadDetail;
      payload.messages = await decryptThreadMessagesForUser(payload.messages || [], user?.id);
      return payload;
    },
  });
}

export function useMailboxConfig() {
  const { user } = useAuth();
  return useQuery<MailboxClientConfig>({
    queryKey: ["mailbox", "config"],
    enabled: !!user,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/mailbox/config");
      return res.json();
    },
  });
}

export function useMailboxE2eeKey() {
  const { user } = useAuth();
  return useQuery<MailboxE2eeKeyPayload>({
    queryKey: ["mailbox", "e2ee", "key", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/mailbox/e2ee/key");
      return res.json();
    },
  });
}

export function useMailboxReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      threadId: number;
      body: string;
      contentFormat?: "PLAINTEXT" | "MARKDOWN";
      e2eeEnvelope?: string;
      e2eeSenderKeyFingerprint?: string;
      bodyDigestSha256?: string;
    }) => {
      const res = await apiRequest("POST", `/api/mailbox/${payload.threadId}/reply`, {
        body: payload.body,
        contentFormat: payload.contentFormat,
        e2eeEnvelope: payload.e2eeEnvelope,
        e2eeSenderKeyFingerprint: payload.e2eeSenderKeyFingerprint,
        bodyDigestSha256: payload.bodyDigestSha256,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox", "thread", variables.threadId] });
    },
  });
}

export function useAdminMailboxReplies(limit = 50, offset = 0) {
  const { user } = useAuth();
  return useQuery<{ rows: MailboxThreadRow[] }>({
    queryKey: ["mailbox", "admin", "replies", limit, offset],
    enabled: !!user?.isAdmin,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/mailbox/admin/replies?limit=${Math.max(1, Math.min(100, limit))}&offset=${Math.max(0, offset)}`,
      );
      return res.json();
    },
  });
}

export function useAdminMailboxSent(limit = 50, offset = 0) {
  const { user } = useAuth();
  return useQuery<{ rows: MailboxThreadRow[] }>({
    queryKey: ["mailbox", "admin", "sent", limit, offset],
    enabled: !!user?.isAdmin,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/mailbox/admin/sent?limit=${Math.max(1, Math.min(100, limit))}&offset=${Math.max(0, offset)}`,
      );
      return res.json();
    },
  });
}

export function useMailboxTargetSearch(q: string, tier = "", limit = 50) {
  const { user } = useAuth();
  return useQuery<{ rows: Array<{ id: number; email: string; username: string; userTier: string; lastActiveAt: number | null }> }>({
    queryKey: ["mailbox", "admin", "targets", q, tier, limit],
    enabled: !!user?.isAdmin && (q.trim().length > 0 || tier.trim().length > 0),
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      if (tier.trim()) qs.set("tier", tier.trim());
      qs.set("limit", String(Math.max(1, Math.min(200, limit))));
      const res = await apiRequest("GET", `/api/mailbox/admin/targets?${qs.toString()}`);
      return res.json();
    },
  });
}

export function useResolveMailboxRecipients() {
  return useMutation({
    mutationFn: async (payload: {
      recipients: {
        mode: "ALL" | "USER_IDS" | "TIER" | "ACTIVE_DAYS";
        userIds?: number[];
        tier?: "CANDIDATE" | "PERFORMER" | "SELECTED";
        activeWithinDays?: number;
      };
    }) => {
      const res = await apiRequest("POST", "/api/mailbox/admin/resolve-recipients", payload);
      return res.json() as Promise<MailboxResolvedRecipientsPayload>;
    },
  });
}

export function useAdminMailboxCompose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      recipients: {
        mode: "ALL" | "USER_IDS" | "TIER" | "ACTIVE_DAYS";
        userIds?: number[];
        tier?: "CANDIDATE" | "PERFORMER" | "SELECTED";
        activeWithinDays?: number;
      };
      subject: string;
      body: string;
      contentFormat?: "PLAINTEXT" | "MARKDOWN";
      allowReply?: boolean;
      category?: "SYSTEM" | "SUPPORT" | "ANNOUNCEMENT";
      confirmLargeTarget?: boolean;
      e2eeEnvelope?: string;
      e2eeSenderKeyFingerprint?: string;
      bodyDigestSha256?: string;
    }) => {
      const res = await apiRequest("POST", "/api/mailbox", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    },
  });
}

export function useAdminCommunicationSettings() {
  const { user } = useAuth();
  return useQuery<CommunicationSettingsRow>({
    queryKey: ["mailbox", "admin", "config"],
    enabled: !!user?.isAdmin,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/mailbox/admin/config");
      return res.json();
    },
  });
}

export function useUpdateAdminCommunicationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: CommunicationSettingsPatchPayload) => {
      const res = await apiRequest("PUT", "/api/mailbox/admin/config", patch);
      return res.json() as Promise<{ ok: true; settings: CommunicationSettingsRow }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox", "admin", "config"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "config"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
