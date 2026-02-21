import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  type CommunicationSettingsPatchPayload,
  useAdminCommunicationSettings,
  useAdminMailboxCompose,
  useAdminMailboxReplies,
  useAdminMailboxSent,
  useMailboxE2eeBootstrap,
  useMailboxLiveSync,
  useMailboxReply,
  useResolveMailboxRecipients,
  useMailboxTargetSearch,
  useMailboxThread,
  useUpdateAdminCommunicationSettings,
} from "@/hooks/use-mailbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ensureMailboxE2eeKey, encryptTextForMailboxRecipients } from "@/lib/e2ee";
import { useAuth } from "@/hooks/use-auth";
import { MessageBody } from "@/components/Mailbox/MessageBody";

type RecipientMode = "ALL" | "USER_IDS" | "TIER" | "ACTIVE_DAYS";
type Tier = "CANDIDATE" | "PERFORMER" | "SELECTED";
type Category = "SYSTEM" | "SUPPORT" | "ANNOUNCEMENT" | "CHALLENGES";
type ContentFormat = "PLAINTEXT" | "MARKDOWN";
type ThreadCategoryFilter = "ALL" | Category;

type MessagingSettingsDraft = {
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
};

type NotificationsSettingsDraft = {
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
  notificationChallengeEnabled: boolean;
};

function formatWhen(value: number | null | undefined): string {
  if (!value) return "";
  const ms = value < 1e12 ? value * 1000 : value;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString();
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export default function AdminCommunications() {
  const { user } = useAuth();
  useMailboxE2eeBootstrap();
  useMailboxLiveSync();
  const { toast } = useToast();

  const composeMutation = useAdminMailboxCompose();
  const replyMutation = useMailboxReply();
  const resolveRecipientsMutation = useResolveMailboxRecipients();
  const repliesQuery = useAdminMailboxReplies(80, 0);
  const sentQuery = useAdminMailboxSent(80, 0);
  const settingsQuery = useAdminCommunicationSettings();
  const updateSettingsMutation = useUpdateAdminCommunicationSettings();

  const [mode, setMode] = useState<RecipientMode>("ALL");
  const [tier, setTier] = useState<Tier>("CANDIDATE");
  const [activeWithinDays, setActiveWithinDays] = useState(7);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [allowReply, setAllowReply] = useState(false);
  const [allowReplyTouched, setAllowReplyTouched] = useState(false);
  const [category, setCategory] = useState<Category>("SUPPORT");
  const [contentFormat, setContentFormat] = useState<ContentFormat>("PLAINTEXT");
  const [confirmLargeTarget, setConfirmLargeTarget] = useState(false);
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());

  const targetQuery = useMailboxTargetSearch(targetSearch, mode === "TIER" ? tier : "", 100);
  const targetRows = targetQuery.data?.rows ?? [];

  const [inboxThreadId, setInboxThreadId] = useState<number | null>(null);
  const [sentThreadId, setSentThreadId] = useState<number | null>(null);
  const [inboxReply, setInboxReply] = useState("");
  const [sentReply, setSentReply] = useState("");
  const [inboxCategoryFilter, setInboxCategoryFilter] = useState<ThreadCategoryFilter>("ALL");
  const [sentCategoryFilter, setSentCategoryFilter] = useState<ThreadCategoryFilter>("ALL");

  const [messagingDraft, setMessagingDraft] = useState<MessagingSettingsDraft | null>(null);
  const [notificationsDraft, setNotificationsDraft] = useState<NotificationsSettingsDraft | null>(null);

  const settings = settingsQuery.data;
  const replyRows = repliesQuery.data?.rows ?? [];
  const sentRows = sentQuery.data?.rows ?? [];
  const filteredReplyRows = replyRows.filter((row) =>
    inboxCategoryFilter === "ALL" ? true : String(row.category) === inboxCategoryFilter,
  );
  const filteredSentRows = sentRows.filter((row) =>
    sentCategoryFilter === "ALL" ? true : String(row.category) === sentCategoryFilter,
  );

  useEffect(() => {
    if (!settings) return;

    setMessagingDraft({
      messagingEnabled: Boolean(settings.messagingEnabled),
      messagingAllowReplyByDefault: Boolean(settings.messagingAllowReplyByDefault),
      messagingAllowBroadcastReplies: Boolean(settings.messagingAllowBroadcastReplies),
      messagingLargeTargetThreshold: Number(settings.messagingLargeTargetThreshold ?? 100),
      messagingMaxRecipientsPerSend: Number(settings.messagingMaxRecipientsPerSend ?? 10000),
      messagingAsyncFanoutThreshold: Number(settings.messagingAsyncFanoutThreshold ?? 200),
      messagingFanoutBatchSize: Number(settings.messagingFanoutBatchSize ?? 500),
      messagingAutoWelcomeEnabled: Boolean(settings.messagingAutoWelcomeEnabled),
      messagingAccountStatusMailboxEnabled: Boolean(settings.messagingAccountStatusMailboxEnabled),
      messagingKycMailboxEnabled: Boolean(settings.messagingKycMailboxEnabled),
      messagingE2eeEnabled: Boolean(settings.messagingE2eeEnabled),
      messagingE2eeRequired: Boolean(settings.messagingE2eeRequired),
    });

    setNotificationsDraft({
      notificationsEnabled: Boolean(settings.notificationsEnabled),
      notificationRealtimeEnabled: Boolean(settings.notificationRealtimeEnabled),
      notificationSoundDefaultEnabled: Boolean(settings.notificationSoundDefaultEnabled),
      notificationE2eeEnabled: Boolean(settings.notificationE2eeEnabled),
      notificationE2eeRequired: Boolean(settings.notificationE2eeRequired),
      notificationTradePendingFillEnabled: Boolean(settings.notificationTradePendingFillEnabled),
      notificationTradeTakeProfitEnabled: Boolean(settings.notificationTradeTakeProfitEnabled),
      notificationTradeStopLossEnabled: Boolean(settings.notificationTradeStopLossEnabled),
      notificationTradeMaxHoldEnabled: Boolean(settings.notificationTradeMaxHoldEnabled),
      notificationAccountFreezeEnabled: Boolean(settings.notificationAccountFreezeEnabled),
      notificationAccountUnfreezeEnabled: Boolean(settings.notificationAccountUnfreezeEnabled),
      notificationKycUpdatesEnabled: Boolean(settings.notificationKycUpdatesEnabled),
      notificationChallengeEnabled: Boolean(settings.notificationChallengeEnabled),
    });

    if (!allowReplyTouched) {
      setAllowReply(Boolean(settings.messagingAllowReplyByDefault));
    }
  }, [allowReplyTouched, settings]);

  useEffect(() => {
    if (inboxThreadId && filteredReplyRows.some((row) => Number(row.threadId) === inboxThreadId)) return;
    setInboxThreadId(filteredReplyRows.length ? Number(filteredReplyRows[0].threadId) : null);
  }, [filteredReplyRows, inboxThreadId]);

  useEffect(() => {
    if (sentThreadId && filteredSentRows.some((row) => Number(row.threadId) === sentThreadId)) return;
    setSentThreadId(filteredSentRows.length ? Number(filteredSentRows[0].threadId) : null);
  }, [filteredSentRows, sentThreadId]);

  const inboxThreadQuery = useMailboxThread(inboxThreadId, 150);
  const sentThreadQuery = useMailboxThread(sentThreadId, 150);

  const selectedCount = selectedUserIds.size;
  const isComposing = composeMutation.isPending || resolveRecipientsMutation.isPending;
  const messagingEnabled = settings?.messagingEnabled ?? true;

  const composeLabel = useMemo(() => {
    if (mode === "ALL") return "All active traders";
    if (mode === "TIER") return `Tier: ${tier}`;
    if (mode === "ACTIVE_DAYS") return `Active in last ${activeWithinDays} days`;
    return `${selectedCount} manually selected users`;
  }, [activeWithinDays, mode, selectedCount, tier]);

  const toggleSelectedUser = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const resetCompose = () => {
    setSubject("");
    setBody("");
    setContentFormat("PLAINTEXT");
    setAllowReply(Boolean(settings?.messagingAllowReplyByDefault));
    setAllowReplyTouched(false);
    setCategory("SUPPORT");
    setConfirmLargeTarget(false);
    setSelectedUserIds(new Set());
  };

  const submitCompose = async (event: FormEvent) => {
    event.preventDefault();
    if (!messagingEnabled) {
      toast({
        title: "Messaging disabled",
        description: "Enable messaging in settings before sending.",
        variant: "destructive",
      });
      return;
    }

    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody) {
      toast({
        title: "Subject and message required",
        description: "Both fields must be provided before sending.",
        variant: "destructive",
      });
      return;
    }

    if (mode === "USER_IDS" && selectedUserIds.size === 0) {
      toast({
        title: "No recipients selected",
        description: "Select at least one user for manual targeting.",
        variant: "destructive",
      });
      return;
    }

    const recipientSelector =
      mode === "USER_IDS"
        ? { mode, userIds: Array.from(selectedUserIds.values()) }
        : mode === "TIER"
          ? { mode, tier }
          : mode === "ACTIVE_DAYS"
            ? { mode, activeWithinDays }
            : { mode };

    try {
      const payload: Parameters<typeof composeMutation.mutateAsync>[0] = {
        recipients: recipientSelector,
        subject: trimmedSubject,
        body: trimmedBody,
        contentFormat,
        allowReply,
        category,
        confirmLargeTarget,
      };

      if (settings?.messagingE2eeEnabled) {
        const senderUserId = Number(user?.id ?? 0);
        if (!Number.isInteger(senderUserId) || senderUserId <= 0) {
          throw new Error("E2EE_SENDER_MISSING");
        }

        const senderKey = await ensureMailboxE2eeKey(senderUserId);
        const resolved = await resolveRecipientsMutation.mutateAsync({ recipients: recipientSelector });
        const recipientsWithKeys = resolved.rows
          .filter((row) => String(row.mailboxPublicKey || "").trim().length > 0)
          .map((row) => ({
            userId: Number(row.id),
            publicKeyPem: row.mailboxPublicKey,
            keyAlgorithm: row.mailboxPublicKeyAlgo,
          }));

        if (!recipientsWithKeys.length && settings.messagingE2eeRequired) {
          throw new Error("E2EE_RECIPIENT_KEYS_REQUIRED");
        }
        if (resolved.missingKeyCount > 0 && settings.messagingE2eeRequired) {
          throw new Error(`E2EE_RECIPIENT_KEYS_MISSING:${resolved.missingKeyCount}`);
        }

        if (recipientsWithKeys.length > 0) {
          const encrypted = await encryptTextForMailboxRecipients(trimmedBody, recipientsWithKeys);
          payload.e2eeEnvelope = encrypted.envelope;
          payload.e2eeSenderKeyFingerprint = senderKey.fingerprint;
          payload.bodyDigestSha256 = encrypted.bodyDigestSha256;
          payload.body = "[Encrypted message]";
        }
      }

      await composeMutation.mutateAsync(payload);

      toast({
        title: "Message sent",
        description: `Targeted: ${composeLabel}`,
      });
      resetCompose();
    } catch (error: any) {
      const isLargeTargetError =
        error instanceof ApiError &&
        (String(error.message) === "LARGE_TARGET_CONFIRMATION_REQUIRED" ||
          String((error as any)?.data?.message) === "LARGE_TARGET_CONFIRMATION_REQUIRED");

      if (isLargeTargetError) {
        setConfirmLargeTarget(true);
        toast({
          title: "Large target confirmation required",
          description: "Enable confirmation and submit again to continue.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Failed to send message",
        description: error?.message || "Unknown mailbox compose error.",
        variant: "destructive",
      });
    }
  };

  const resolveThreadParticipants = (threadId: number | null) => {
    if (!threadId) return [] as Array<{ userId: number; mailboxPublicKey: string; mailboxPublicKeyAlgo: string | null }>;
    const source =
      Number(inboxThreadId) === Number(threadId)
        ? inboxThreadQuery.data?.participants
        : Number(sentThreadId) === Number(threadId)
          ? sentThreadQuery.data?.participants
          : [];
    return (source ?? [])
      .map((row) => ({
        userId: Number(row.userId),
        mailboxPublicKey: String(row.mailboxPublicKey ?? "").trim(),
        mailboxPublicKeyAlgo: row.mailboxPublicKeyAlgo ?? null,
      }))
      .filter(
        (row) =>
          Number.isInteger(row.userId) &&
          row.userId > 0 &&
          row.userId !== Number(user?.id ?? 0) &&
          row.mailboxPublicKey.length > 0,
      );
  };

  const submitThreadReply = async (threadId: number | null, text: string, clear: () => void) => {
    if (!threadId || !text.trim()) return;
    try {
      const payload: Parameters<typeof replyMutation.mutateAsync>[0] = {
        threadId,
        body: text.trim(),
        contentFormat: "PLAINTEXT",
        optimisticBody: text.trim(),
      };

      if (settings?.messagingE2eeEnabled) {
        const senderUserId = Number(user?.id ?? 0);
        if (!Number.isInteger(senderUserId) || senderUserId <= 0) {
          throw new Error("E2EE_SENDER_MISSING");
        }

        const recipientKeys = resolveThreadParticipants(threadId);
        if (!recipientKeys.length && settings.messagingE2eeRequired) {
          throw new Error("E2EE_RECIPIENT_KEYS_REQUIRED");
        }

        if (recipientKeys.length > 0) {
          const senderKey = await ensureMailboxE2eeKey(senderUserId);
          const encrypted = await encryptTextForMailboxRecipients(
            text.trim(),
            recipientKeys.map((row) => ({
              userId: row.userId,
              publicKeyPem: row.mailboxPublicKey,
              keyAlgorithm: row.mailboxPublicKeyAlgo,
            })),
          );
          payload.e2eeEnvelope = encrypted.envelope;
          payload.e2eeSenderKeyFingerprint = senderKey.fingerprint;
          payload.bodyDigestSha256 = encrypted.bodyDigestSha256;
          payload.body = "[Encrypted message]";
        }
      }

      await replyMutation.mutateAsync(payload);
      clear();
    } catch (error: any) {
      toast({
        title: "Reply failed",
        description: error?.message || "Unable to send reply.",
        variant: "destructive",
      });
    }
  };

  const saveSettings = async (patch: CommunicationSettingsPatchPayload, message: string) => {
    try {
      await updateSettingsMutation.mutateAsync(patch);
      toast({
        title: "Configuration saved",
        description: message,
      });
    } catch (error: any) {
      toast({
        title: "Failed to save settings",
        description: error?.message || "Unable to update communication settings.",
        variant: "destructive",
      });
    }
  };

  const submitMessagingSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!messagingDraft) return;

    await saveSettings(
      {
        messagingEnabled: messagingDraft.messagingEnabled,
        messagingAllowReplyByDefault: messagingDraft.messagingAllowReplyByDefault,
        messagingAllowBroadcastReplies: messagingDraft.messagingAllowBroadcastReplies,
        messagingLargeTargetThreshold: messagingDraft.messagingLargeTargetThreshold,
        messagingMaxRecipientsPerSend: messagingDraft.messagingMaxRecipientsPerSend,
        messagingAsyncFanoutThreshold: messagingDraft.messagingAsyncFanoutThreshold,
        messagingFanoutBatchSize: messagingDraft.messagingFanoutBatchSize,
        messagingAutoWelcomeEnabled: messagingDraft.messagingAutoWelcomeEnabled,
        messagingAccountStatusMailboxEnabled: messagingDraft.messagingAccountStatusMailboxEnabled,
        messagingKycMailboxEnabled: messagingDraft.messagingKycMailboxEnabled,
        messagingE2eeEnabled: messagingDraft.messagingE2eeEnabled,
        messagingE2eeRequired: messagingDraft.messagingE2eeRequired,
      },
      "Messaging settings propagated to active sessions.",
    );
  };

  const submitNotificationSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!notificationsDraft) return;

    await saveSettings(
      {
        notificationsEnabled: notificationsDraft.notificationsEnabled,
        notificationRealtimeEnabled: notificationsDraft.notificationRealtimeEnabled,
        notificationSoundDefaultEnabled: notificationsDraft.notificationSoundDefaultEnabled,
        notificationE2eeEnabled: notificationsDraft.notificationE2eeEnabled,
        notificationE2eeRequired: notificationsDraft.notificationE2eeRequired,
        notificationTradePendingFillEnabled: notificationsDraft.notificationTradePendingFillEnabled,
        notificationTradeTakeProfitEnabled: notificationsDraft.notificationTradeTakeProfitEnabled,
        notificationTradeStopLossEnabled: notificationsDraft.notificationTradeStopLossEnabled,
        notificationTradeMaxHoldEnabled: notificationsDraft.notificationTradeMaxHoldEnabled,
        notificationAccountFreezeEnabled: notificationsDraft.notificationAccountFreezeEnabled,
        notificationAccountUnfreezeEnabled: notificationsDraft.notificationAccountUnfreezeEnabled,
        notificationKycUpdatesEnabled: notificationsDraft.notificationKycUpdatesEnabled,
        notificationChallengeEnabled: notificationsDraft.notificationChallengeEnabled,
      },
      "Notification settings propagated to active sessions.",
    );
  };

  return (
    <Card className="bg-neutral-800 border-gray-700">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base">Communications</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="messaging" className="space-y-3">
          <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-2 gap-1">
            <TabsTrigger value="messaging" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
              Messaging
            </TabsTrigger>
            <TabsTrigger value="notifications" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
              Notifications
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messaging" className="space-y-3">
            {!messagingEnabled ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Messaging is disabled. Compose and reply actions are blocked until re-enabled in settings.
              </div>
            ) : null}

            <Tabs defaultValue="compose" className="space-y-3">
              <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-2 md:grid-cols-4 gap-1">
                <TabsTrigger value="compose" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
                  Compose
                </TabsTrigger>
                <TabsTrigger value="inbox" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
                  Inbox
                </TabsTrigger>
                <TabsTrigger value="sent" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
                  Sent
                </TabsTrigger>
                <TabsTrigger value="settings" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
                  Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent value="compose" className="space-y-3">
                <form onSubmit={submitCompose} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="text-sm text-gray-300">
                      Target mode
                      <select
                        value={mode}
                        onChange={(event) => setMode(event.target.value as RecipientMode)}
                        className="mt-1 w-full rounded-md border border-gray-700 bg-neutral-900 text-white px-3 py-2"
                      >
                        <option value="ALL">All active traders</option>
                        <option value="TIER">Tier filter</option>
                        <option value="ACTIVE_DAYS">Recently active cohort</option>
                        <option value="USER_IDS">Manual user selection</option>
                      </select>
                    </label>

                    <label className="text-sm text-gray-300">
                      Category
                      <select
                        value={category}
                        onChange={(event) => setCategory(event.target.value as Category)}
                        className="mt-1 w-full rounded-md border border-gray-700 bg-neutral-900 text-white px-3 py-2"
                      >
                        <option value="SUPPORT">Support</option>
                        <option value="SYSTEM">System</option>
                        <option value="ANNOUNCEMENT">Announcement</option>
                        <option value="CHALLENGES">Challenges</option>
                      </select>
                    </label>
                  </div>

                  <label className="text-sm text-gray-300">
                    Message format
                    <select
                      value={contentFormat}
                      onChange={(event) => setContentFormat(event.target.value as ContentFormat)}
                      className="mt-1 w-full rounded-md border border-gray-700 bg-neutral-900 text-white px-3 py-2"
                    >
                      <option value="PLAINTEXT">Plain text</option>
                      <option value="MARKDOWN">Markdown</option>
                    </select>
                  </label>

                  {mode === "TIER" ? (
                    <label className="text-sm text-gray-300">
                      Tier
                      <select
                        value={tier}
                        onChange={(event) => setTier(event.target.value as Tier)}
                        className="mt-1 w-full rounded-md border border-gray-700 bg-neutral-900 text-white px-3 py-2"
                      >
                        <option value="CANDIDATE">Candidate</option>
                        <option value="PERFORMER">Performer</option>
                        <option value="SELECTED">Selected</option>
                      </select>
                    </label>
                  ) : null}

                  {mode === "ACTIVE_DAYS" ? (
                    <label className="text-sm text-gray-300">
                      Active within (days)
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={activeWithinDays}
                        onChange={(event) => setActiveWithinDays(clampInt(event.target.value, 7, 1, 365))}
                        className="mt-1 bg-neutral-900 border-gray-700"
                      />
                    </label>
                  ) : null}

                  {mode === "USER_IDS" ? (
                    <div className="space-y-2">
                      <label className="text-sm text-gray-300">
                        Search users (email or username)
                        <Input
                          value={targetSearch}
                          onChange={(event) => setTargetSearch(event.target.value)}
                          placeholder="Search users..."
                          className="mt-1 bg-neutral-900 border-gray-700"
                        />
                      </label>
                      <div className="max-h-44 overflow-y-auto rounded-md border border-gray-700 bg-neutral-900">
                        {!targetSearch.trim() ? (
                          <div className="px-3 py-3 text-xs text-gray-400">Type to search users.</div>
                        ) : targetQuery.isLoading ? (
                          <div className="px-3 py-3 text-xs text-gray-400">Searching users…</div>
                        ) : !targetRows.length ? (
                          <div className="px-3 py-3 text-xs text-gray-400">No users found.</div>
                        ) : (
                          targetRows.map((row) => {
                            const checked = selectedUserIds.has(Number(row.id));
                            return (
                              <label key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-800/70 text-sm text-gray-200">
                                <div className="min-w-0">
                                  <div className="truncate">{row.username} ({row.email})</div>
                                  <div className="text-[11px] text-gray-500">Tier: {row.userTier || "—"}</div>
                                </div>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleSelectedUser(Number(row.id))}
                                  className="h-4 w-4 shrink-0"
                                />
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}

                  <label className="text-sm text-gray-300 block">
                    Subject
                    <Input
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      placeholder="Subject line"
                      className="mt-1 bg-neutral-900 border-gray-700"
                      maxLength={160}
                    />
                  </label>

                  <label className="text-sm text-gray-300 block">
                    Message
                    <Textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      placeholder="Write your message..."
                      className="mt-1 min-h-[140px] bg-neutral-900 border-gray-700 text-white"
                      maxLength={8000}
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                      <Switch
                        checked={allowReply}
                        onCheckedChange={(checked) => {
                          setAllowReply(Boolean(checked));
                          setAllowReplyTouched(true);
                        }}
                      />
                      Allow replies
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={confirmLargeTarget}
                        onChange={(event) => setConfirmLargeTarget(event.target.checked)}
                        className="h-4 w-4"
                      />
                      Confirm large target sends
                    </label>
                    <span className="text-xs text-gray-400">Target: {composeLabel}</span>
                  </div>
                  {settings?.messagingE2eeEnabled ? (
                    <div className="text-xs text-cyan-300/90">
                      End-to-end encryption is enabled for compose/reply flows. Messages are encrypted client-side
                      when recipient keys are available.
                    </div>
                  ) : null}
                  {allowReply && settings && !settings.messagingAllowBroadcastReplies ? (
                    <div className="text-xs text-amber-300">
                      Broadcast replies are disabled in messaging settings. Reply-enabled sends may be restricted to 1:1 targeting.
                    </div>
                  ) : null}

                  <div className="flex justify-end">
                    <Button type="submit" disabled={isComposing || !messagingEnabled}>
                      {isComposing ? "Sending…" : "Send Message"}
                    </Button>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="inbox">
                <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-3">
                  <div className="rounded-md border border-gray-700 bg-neutral-900/60 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">Inbound replies</span>
                      <select
                        value={inboxCategoryFilter}
                        onChange={(event) => setInboxCategoryFilter(event.target.value as ThreadCategoryFilter)}
                        className="rounded border border-gray-700 bg-neutral-950 text-[11px] text-gray-200 px-2 py-1"
                      >
                        <option value="ALL">All categories</option>
                        <option value="SYSTEM">System</option>
                        <option value="SUPPORT">Support</option>
                        <option value="ANNOUNCEMENT">Announcement</option>
                        <option value="CHALLENGES">Challenges</option>
                      </select>
                    </div>
                    <div className="max-h-[460px] overflow-y-auto">
                      {repliesQuery.isLoading ? (
                        <div className="px-3 py-3 text-sm text-gray-400">Loading inbox…</div>
                      ) : !filteredReplyRows.length ? (
                        <div className="px-3 py-3 text-sm text-gray-400">No replies yet.</div>
                      ) : (
                        filteredReplyRows.map((row) => (
                          <button
                            key={row.threadId}
                            type="button"
                            onClick={() => setInboxThreadId(Number(row.threadId))}
                            className={`w-full text-left px-3 py-2 border-b border-gray-800/70 hover:bg-white/[0.04] ${Number(row.threadId) === inboxThreadId ? "bg-blue-500/10" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm text-white truncate">{row.subject || "Message"}</div>
                              {Number(row.unreadUserReplyCount ?? 0) > 0 ? (
                                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-200">
                                  {row.unreadUserReplyCount} new
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-400 truncate mt-0.5">{row.latestBody}</div>
                            <div className="text-[11px] text-gray-500 mt-1">
                              {formatWhen(row.latestUserReplyAt || row.latestCreatedAt)}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-gray-700 bg-neutral-900/60 min-h-[460px] flex flex-col">
                    <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
                      {inboxThreadQuery.data?.thread?.subject || "Select a thread"}
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {!inboxThreadId ? (
                        <div className="text-sm text-gray-400">Select a thread to inspect replies.</div>
                      ) : inboxThreadQuery.isLoading ? (
                        <div className="text-sm text-gray-400">Loading thread…</div>
                      ) : (
                        (inboxThreadQuery.data?.messages || []).map((message) => (
                          <div key={message.id} className={`flex ${message.senderIsAdmin ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`w-full max-w-[92%] rounded-md border p-2 ${
                                message.senderIsAdmin
                                  ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-50"
                                  : "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`text-[11px] font-medium ${
                                    message.senderIsAdmin ? "text-cyan-200" : "text-emerald-200"
                                  }`}
                                >
                                  {message.senderIsAdmin ? "Sent" : "Reply"}
                                </span>
                                <span className="text-[11px] text-gray-400">{formatWhen(message.createdAt)}</span>
                              </div>
                              <div className="text-xs text-gray-300 mt-0.5">
                                {message.senderUsername || message.senderEmail || "System"}
                              </div>
                              <MessageBody
                                body={message.body}
                                contentFormat={message.contentFormat}
                                className="text-sm whitespace-pre-wrap mt-1 break-words"
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <form
                      className="border-t border-gray-700 p-3 space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitThreadReply(inboxThreadId, inboxReply, () => setInboxReply(""));
                      }}
                    >
                      <Textarea
                        value={inboxReply}
                        onChange={(event) => setInboxReply(event.target.value)}
                        placeholder="Reply to selected thread..."
                        className="min-h-[84px] bg-neutral-950 border-gray-700 text-white"
                        disabled={!inboxThreadId || replyMutation.isPending || !messagingEnabled}
                      />
                      <div className="flex justify-end">
                        <Button type="submit" disabled={!inboxThreadId || !inboxReply.trim() || replyMutation.isPending || !messagingEnabled}>
                          Send Reply
                        </Button>
                      </div>
                    </form>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="sent">
                <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-3">
                  <div className="rounded-md border border-gray-700 bg-neutral-900/60 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">Sent history</span>
                      <select
                        value={sentCategoryFilter}
                        onChange={(event) => setSentCategoryFilter(event.target.value as ThreadCategoryFilter)}
                        className="rounded border border-gray-700 bg-neutral-950 text-[11px] text-gray-200 px-2 py-1"
                      >
                        <option value="ALL">All categories</option>
                        <option value="SYSTEM">System</option>
                        <option value="SUPPORT">Support</option>
                        <option value="ANNOUNCEMENT">Announcement</option>
                        <option value="CHALLENGES">Challenges</option>
                      </select>
                    </div>
                    <div className="max-h-[460px] overflow-y-auto">
                      {sentQuery.isLoading ? (
                        <div className="px-3 py-3 text-sm text-gray-400">Loading sent history…</div>
                      ) : !filteredSentRows.length ? (
                        <div className="px-3 py-3 text-sm text-gray-400">No sent threads.</div>
                      ) : (
                        filteredSentRows.map((row) => (
                          <button
                            key={row.threadId}
                            type="button"
                            onClick={() => setSentThreadId(Number(row.threadId))}
                            className={`w-full text-left px-3 py-2 border-b border-gray-800/70 hover:bg-white/[0.04] ${Number(row.threadId) === sentThreadId ? "bg-emerald-500/10" : ""}`}
                          >
                            <div className="text-sm text-white truncate">{row.subject || "Message"}</div>
                            <div className="text-xs text-gray-400 truncate mt-0.5">{row.latestBody}</div>
                            <div className="text-[11px] text-gray-500 mt-1">{formatWhen(row.latestCreatedAt)}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-gray-700 bg-neutral-900/60 min-h-[460px] flex flex-col">
                    <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
                      {sentThreadQuery.data?.thread?.subject || "Select a sent thread"}
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {!sentThreadId ? (
                        <div className="text-sm text-gray-400">Select a sent thread to inspect.</div>
                      ) : sentThreadQuery.isLoading ? (
                        <div className="text-sm text-gray-400">Loading thread…</div>
                      ) : (
                        (sentThreadQuery.data?.messages || []).map((message) => (
                          <div key={message.id} className={`flex ${message.senderIsAdmin ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`w-full max-w-[92%] rounded-md border p-2 ${
                                message.senderIsAdmin
                                  ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-50"
                                  : "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`text-[11px] font-medium ${
                                    message.senderIsAdmin ? "text-cyan-200" : "text-emerald-200"
                                  }`}
                                >
                                  {message.senderIsAdmin ? "Sent" : "Reply"}
                                </span>
                                <span className="text-[11px] text-gray-400">{formatWhen(message.createdAt)}</span>
                              </div>
                              <div className="text-xs text-gray-300 mt-0.5">
                                {message.senderUsername || message.senderEmail || "System"}
                              </div>
                              <MessageBody
                                body={message.body}
                                contentFormat={message.contentFormat}
                                className="text-sm whitespace-pre-wrap mt-1 break-words"
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <form
                      className="border-t border-gray-700 p-3 space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitThreadReply(sentThreadId, sentReply, () => setSentReply(""));
                      }}
                    >
                      <Textarea
                        value={sentReply}
                        onChange={(event) => setSentReply(event.target.value)}
                        placeholder="Follow up on this thread..."
                        className="min-h-[84px] bg-neutral-950 border-gray-700 text-white"
                        disabled={!sentThreadId || replyMutation.isPending || !messagingEnabled}
                      />
                      <div className="flex justify-end">
                        <Button type="submit" disabled={!sentThreadId || !sentReply.trim() || replyMutation.isPending || !messagingEnabled}>
                          Send Follow-up
                        </Button>
                      </div>
                    </form>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="settings">
                {!messagingDraft || settingsQuery.isLoading ? (
                  <div className="text-sm text-gray-400">Loading messaging settings…</div>
                ) : (
                  <form onSubmit={submitMessagingSettings} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                        Messaging enabled
                        <Switch
                          checked={messagingDraft.messagingEnabled}
                          onCheckedChange={(checked) =>
                            setMessagingDraft((prev) =>
                              prev ? { ...prev, messagingEnabled: Boolean(checked) } : prev,
                            )
                          }
                        />
                      </label>
                      <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                        Default allow reply
                        <Switch
                          checked={messagingDraft.messagingAllowReplyByDefault}
                          onCheckedChange={(checked) =>
                            setMessagingDraft((prev) =>
                              prev ? { ...prev, messagingAllowReplyByDefault: Boolean(checked) } : prev,
                            )
                          }
                        />
                      </label>
                      <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                        Allow broadcast replies
                        <Switch
                          checked={messagingDraft.messagingAllowBroadcastReplies}
                          onCheckedChange={(checked) =>
                            setMessagingDraft((prev) =>
                              prev ? { ...prev, messagingAllowBroadcastReplies: Boolean(checked) } : prev,
                            )
                          }
                        />
                      </label>
                      <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                        Auto welcome message
                        <Switch
                          checked={messagingDraft.messagingAutoWelcomeEnabled}
                          onCheckedChange={(checked) =>
                            setMessagingDraft((prev) =>
                              prev ? { ...prev, messagingAutoWelcomeEnabled: Boolean(checked) } : prev,
                            )
                          }
                        />
                      </label>
                      <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                        Account status mailbox events
                        <Switch
                          checked={messagingDraft.messagingAccountStatusMailboxEnabled}
                          onCheckedChange={(checked) =>
                            setMessagingDraft((prev) =>
                              prev ? { ...prev, messagingAccountStatusMailboxEnabled: Boolean(checked) } : prev,
                            )
                          }
                        />
                      </label>
                      <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                        KYC mailbox events
                        <Switch
                          checked={messagingDraft.messagingKycMailboxEnabled}
                          onCheckedChange={(checked) =>
                            setMessagingDraft((prev) =>
                              prev ? { ...prev, messagingKycMailboxEnabled: Boolean(checked) } : prev,
                            )
                          }
                        />
                      </label>
                      <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                        Messaging E2EE enabled
                        <Switch
                          checked={messagingDraft.messagingE2eeEnabled}
                          onCheckedChange={(checked) =>
                            setMessagingDraft((prev) =>
                              prev ? { ...prev, messagingE2eeEnabled: Boolean(checked) } : prev,
                            )
                          }
                        />
                      </label>
                      <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                        Require E2EE for user sends
                        <Switch
                          checked={messagingDraft.messagingE2eeRequired}
                          onCheckedChange={(checked) =>
                            setMessagingDraft((prev) =>
                              prev ? { ...prev, messagingE2eeRequired: Boolean(checked) } : prev,
                            )
                          }
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="text-sm text-gray-300 block">
                        Large-target confirm threshold
                        <Input
                          type="number"
                          min={1}
                          max={20000}
                          value={messagingDraft.messagingLargeTargetThreshold}
                          onChange={(event) =>
                            setMessagingDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    messagingLargeTargetThreshold: clampInt(event.target.value, prev.messagingLargeTargetThreshold, 1, 20000),
                                  }
                                : prev,
                            )
                          }
                          className="mt-1 bg-neutral-900 border-gray-700"
                        />
                      </label>
                      <label className="text-sm text-gray-300 block">
                        Max recipients per send
                        <Input
                          type="number"
                          min={1}
                          max={200000}
                          value={messagingDraft.messagingMaxRecipientsPerSend}
                          onChange={(event) =>
                            setMessagingDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    messagingMaxRecipientsPerSend: clampInt(event.target.value, prev.messagingMaxRecipientsPerSend, 1, 200000),
                                  }
                                : prev,
                            )
                          }
                          className="mt-1 bg-neutral-900 border-gray-700"
                        />
                      </label>
                      <label className="text-sm text-gray-300 block">
                        Async fanout threshold
                        <Input
                          type="number"
                          min={1}
                          max={50000}
                          value={messagingDraft.messagingAsyncFanoutThreshold}
                          onChange={(event) =>
                            setMessagingDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    messagingAsyncFanoutThreshold: clampInt(event.target.value, prev.messagingAsyncFanoutThreshold, 1, 50000),
                                  }
                                : prev,
                            )
                          }
                          className="mt-1 bg-neutral-900 border-gray-700"
                        />
                      </label>
                      <label className="text-sm text-gray-300 block">
                        Fanout batch size
                        <Input
                          type="number"
                          min={50}
                          max={5000}
                          value={messagingDraft.messagingFanoutBatchSize}
                          onChange={(event) =>
                            setMessagingDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    messagingFanoutBatchSize: clampInt(event.target.value, prev.messagingFanoutBatchSize, 50, 5000),
                                  }
                                : prev,
                            )
                          }
                          className="mt-1 bg-neutral-900 border-gray-700"
                        />
                      </label>
                    </div>

                    <div className="flex justify-end">
                      <Button type="submit" disabled={updateSettingsMutation.isPending}>
                        {updateSettingsMutation.isPending ? "Saving…" : "Save Messaging Settings"}
                      </Button>
                    </div>
                    <div className="text-xs text-gray-500 text-right">
                      Last updated: {settings?.updatedAt ? formatWhen(settings.updatedAt) : "—"}
                      {settings?.updatedBy ? ` by ${settings.updatedBy}` : ""}
                    </div>
                  </form>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="notifications">
            {!notificationsDraft || settingsQuery.isLoading ? (
              <div className="text-sm text-gray-400">Loading notification settings…</div>
            ) : (
              <form onSubmit={submitNotificationSettings} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Notifications enabled
                    <Switch
                      checked={notificationsDraft.notificationsEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationsEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Realtime websocket push
                    <Switch
                      checked={notificationsDraft.notificationRealtimeEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationRealtimeEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Sound default enabled
                    <Switch
                      checked={notificationsDraft.notificationSoundDefaultEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationSoundDefaultEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Notification E2EE enabled
                    <Switch
                      checked={notificationsDraft.notificationE2eeEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationE2eeEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Require E2EE when key exists
                    <Switch
                      checked={notificationsDraft.notificationE2eeRequired}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationE2eeRequired: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Pending fill alerts
                    <Switch
                      checked={notificationsDraft.notificationTradePendingFillEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationTradePendingFillEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Take profit alerts
                    <Switch
                      checked={notificationsDraft.notificationTradeTakeProfitEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationTradeTakeProfitEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Stop loss alerts
                    <Switch
                      checked={notificationsDraft.notificationTradeStopLossEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationTradeStopLossEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Max-hold auto-close alerts
                    <Switch
                      checked={notificationsDraft.notificationTradeMaxHoldEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationTradeMaxHoldEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Account freeze alerts
                    <Switch
                      checked={notificationsDraft.notificationAccountFreezeEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationAccountFreezeEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Account unfreeze alerts
                    <Switch
                      checked={notificationsDraft.notificationAccountUnfreezeEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationAccountUnfreezeEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    KYC status alerts
                    <Switch
                      checked={notificationsDraft.notificationKycUpdatesEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationKycUpdatesEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="inline-flex items-center justify-between rounded-md border border-gray-700 bg-neutral-900 px-3 py-2 text-sm text-gray-200">
                    Challenge alerts
                    <Switch
                      checked={notificationsDraft.notificationChallengeEnabled}
                      onCheckedChange={(checked) =>
                        setNotificationsDraft((prev) =>
                          prev ? { ...prev, notificationChallengeEnabled: Boolean(checked) } : prev,
                        )
                      }
                    />
                  </label>
                </div>

                <div className="text-xs text-gray-500">
                  Last updated: {settings?.updatedAt ? formatWhen(settings.updatedAt) : "—"}
                  {settings?.updatedBy ? ` by ${settings.updatedBy}` : ""}
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={updateSettingsMutation.isPending}>
                    {updateSettingsMutation.isPending ? "Saving…" : "Save Notification Settings"}
                  </Button>
                </div>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
