import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { playNotificationSound } from "@/lib/notificationSound";
import { decryptMailboxEnvelopeForUser, getStoredMailboxE2eeKey } from "@/lib/e2ee";

export type NotificationRow = {
  id: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  contentEncoding?: string;
  e2eeEnvelope?: string | null;
  isRead: boolean;
  createdAt: number;
  readAt: number | null;
  link: string | null;
};

type NotificationsPayload = {
  rows: NotificationRow[];
  unreadCount: number;
};

export type NotificationClientConfig = {
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
};

function isMessageForUser(message: any, userId: number | undefined): boolean {
  if (!userId) return false;
  const eventUserId = Number(message?.userId ?? 0);
  return !eventUserId || eventUserId === userId;
}

async function decryptNotificationRows(rows: NotificationRow[], userId: number | undefined): Promise<NotificationRow[]> {
  if (!userId || !rows.length) return rows;
  const key = getStoredMailboxE2eeKey(userId);
  if (!key?.privateKeyJwk) return rows;

  const next = await Promise.all(
    rows.map(async (row) => {
      if (row.contentEncoding !== "E2EE_ENVELOPE_V1" || !row.e2eeEnvelope) return row;
      const decrypted = await decryptMailboxEnvelopeForUser({
        envelopeJson: row.e2eeEnvelope,
        userId,
        privateKeyJwk: key.privateKeyJwk,
      });
      if (!decrypted) return row;

      try {
        const parsed = JSON.parse(decrypted) as { title?: string; message?: string };
        return {
          ...row,
          title: String(parsed?.title ?? row.title),
          message: String(parsed?.message ?? row.message),
        };
      } catch {
        return row;
      }
    }),
  );

  return next;
}

export function useNotifications(limit = 30) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { subscribe } = useLiveUpdates();
  const configQuery = useQuery<NotificationClientConfig>({
    queryKey: ["notifications", "config"],
    enabled: !!user,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/notifications/config");
      return res.json();
    },
  });
  const notificationConfig = configQuery.data;

  useEffect(() => {
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "communications:config-updated") {
        queryClient.invalidateQueries({ queryKey: ["notifications", "config"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        return;
      }
      if (!isMessageForUser(message, user?.id)) return;

      if (message.type === "notifications:new") {
        if (message?.payload?.playSound !== false) {
          playNotificationSound({
            adminSoundEnabled: notificationConfig?.notificationSoundDefaultEnabled ?? true,
          });
        }
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        return;
      }

      if (message.type === "notifications:updated") {
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
    });
  }, [notificationConfig?.notificationSoundDefaultEnabled, queryClient, subscribe, user?.id]);

  const query = useQuery<NotificationsPayload>({
    queryKey: ["notifications", limit, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/notifications?limit=${Math.max(1, Math.min(100, limit))}`);
      const payload = (await res.json()) as NotificationsPayload;
      payload.rows = await decryptNotificationRows(payload.rows || [], user?.id);
      return payload;
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (payload: { ids?: number[]; all?: boolean }) => {
      const res = await apiRequest("POST", "/api/notifications/mark-read", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const rows = query.data?.rows ?? [];
  const unreadCount = Number(query.data?.unreadCount ?? 0);

  return {
    ...query,
    config: notificationConfig,
    configQuery,
    rows,
    unreadCount,
    markRead: (ids: number[]) => markReadMutation.mutate({ ids }),
    markReadAsync: (ids: number[]) => markReadMutation.mutateAsync({ ids }),
    markAllRead: () => markReadMutation.mutate({ all: true }),
    markAllReadAsync: () => markReadMutation.mutateAsync({ all: true }),
    markReadMutation,
  };
}
