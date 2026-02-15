import { FormEvent, useEffect, useMemo, useState } from "react";
import { Lock, Mail, SendHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import {
  useMailboxConfig,
  useMailboxE2eeBootstrap,
  useMailboxLiveSync,
  useMailboxReply,
  useMailboxThread,
  useMailboxThreads,
} from "@/hooks/use-mailbox";
import { useToast } from "@/hooks/use-toast";
import { ensureMailboxE2eeKey, encryptTextForMailboxRecipients } from "@/lib/e2ee";
import { MessageBody } from "@/components/Mailbox/MessageBody";

type ThreadCategoryFilter = "ALL" | "SYSTEM" | "SUPPORT" | "ANNOUNCEMENT" | "CHALLENGES";
type ReplyFormat = "PLAINTEXT" | "MARKDOWN";

function formatWhen(value: number | null | undefined): string {
  if (!value) return "";
  const ms = value < 1e12 ? value * 1000 : value;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString();
}

export function MailboxMinitab() {
  useMailboxLiveSync();
  useMailboxE2eeBootstrap();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: threadsPayload, isLoading: isThreadsLoading } = useMailboxThreads(40, 0);
  const mailboxConfigQuery = useMailboxConfig();
  const threads = threadsPayload?.rows ?? [];
  const unreadCount = Number(threadsPayload?.unreadCount ?? 0);
  const messagingEnabled = mailboxConfigQuery.data?.messagingEnabled ?? true;
  const messagingE2eeEnabled = mailboxConfigQuery.data?.messagingE2eeEnabled ?? false;
  const messagingE2eeRequired = mailboxConfigQuery.data?.messagingE2eeRequired ?? false;

  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyFormat, setReplyFormat] = useState<ReplyFormat>("PLAINTEXT");
  const [categoryFilter, setCategoryFilter] = useState<ThreadCategoryFilter>("ALL");

  const filteredThreads = useMemo(
    () => threads.filter((row) => (categoryFilter === "ALL" ? true : String(row.category) === categoryFilter)),
    [categoryFilter, threads],
  );

  useEffect(() => {
    if (selectedThreadId && filteredThreads.some((row) => Number(row.threadId) === selectedThreadId)) return;
    setSelectedThreadId(filteredThreads.length ? Number(filteredThreads[0].threadId) : null);
  }, [filteredThreads, selectedThreadId]);

  const threadQuery = useMailboxThread(selectedThreadId, 150);
  const thread = threadQuery.data?.thread;
  const participants = threadQuery.data?.participants ?? [];
  const messages = threadQuery.data?.messages ?? [];
  const replyMutation = useMailboxReply();

  const latestMessage = useMemo(() => {
    if (!messages.length) return null;
    return messages[messages.length - 1];
  }, [messages]);

  const canReply = Boolean(messagingEnabled && (user?.isAdmin || latestMessage?.allowReply));

  const onReplySubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = replyBody.trim();
    if (!selectedThreadId || !body) return;

    try {
      const payload: Parameters<typeof replyMutation.mutateAsync>[0] = {
        threadId: selectedThreadId,
        body,
        contentFormat: replyFormat,
        optimisticBody: body,
      };

      if (messagingE2eeEnabled) {
        const senderUserId = Number(user?.id ?? 0);
        if (!Number.isInteger(senderUserId) || senderUserId <= 0) {
          throw new Error("E2EE_SENDER_MISSING");
        }

        const recipientKeys = participants
          .map((row) => ({
            userId: Number(row.userId),
            publicKeyPem: String(row.mailboxPublicKey ?? "").trim(),
            keyAlgorithm: row.mailboxPublicKeyAlgo,
          }))
          .filter(
            (row) =>
              Number.isInteger(row.userId) &&
              row.userId > 0 &&
              row.userId !== senderUserId &&
              row.publicKeyPem.length > 0,
          );

        if (!recipientKeys.length && messagingE2eeRequired) {
          throw new Error("E2EE_RECIPIENT_KEYS_REQUIRED");
        }

        if (recipientKeys.length > 0) {
          const senderKey = await ensureMailboxE2eeKey(senderUserId);
          const encrypted = await encryptTextForMailboxRecipients(body, recipientKeys);
          payload.e2eeEnvelope = encrypted.envelope;
          payload.e2eeSenderKeyFingerprint = senderKey.fingerprint;
          payload.bodyDigestSha256 = encrypted.bodyDigestSha256;
          payload.body = "[Encrypted message]";
        }
      }

      await replyMutation.mutateAsync(payload);
      setReplyBody("");
    } catch (error: any) {
      toast({
        title: "Reply failed",
        description: error?.message || "Unable to send reply.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="tq-account-card tq-mailbox-card bg-neutral-800 border-gray-700">
      <CardHeader className="pb-3 px-3 sm:px-6">
        <CardTitle className="flex items-center justify-between gap-2 text-white text-sm sm:text-base">
          <span className="inline-flex items-center gap-2">
            <Mail className="h-4 w-4 text-sky-400" />
            Mailbox
          </span>
          {unreadCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 text-sky-300 px-2 py-0.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              {unreadCount} unread
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 sm:px-6 pb-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
          <div className="tq-mailbox-threads rounded-lg border border-gray-700 bg-neutral-900/40 overflow-hidden">
            <div className="tq-mailbox-strip px-3 py-2 text-xs text-gray-400 border-b border-gray-700 flex items-center justify-between gap-2">
              <span>Threads</span>
              <Select
                value={categoryFilter}
                onValueChange={(value) => setCategoryFilter(value as ThreadCategoryFilter)}
              >
                <SelectTrigger className="tq-mailbox-select-trigger h-7 min-w-[104px] bg-neutral-950 border-gray-700 text-[11px] px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="tq-mailbox-select-content">
                  <SelectItem className="tq-mailbox-select-item" value="ALL">All</SelectItem>
                  <SelectItem className="tq-mailbox-select-item" value="SYSTEM">System</SelectItem>
                  <SelectItem className="tq-mailbox-select-item" value="SUPPORT">Support</SelectItem>
                  <SelectItem className="tq-mailbox-select-item" value="ANNOUNCEMENT">Announcement</SelectItem>
                  <SelectItem className="tq-mailbox-select-item" value="CHALLENGES">Challenges</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {isThreadsLoading ? (
                <div className="px-3 py-4 text-sm text-gray-400">Loading mailbox…</div>
              ) : !filteredThreads.length ? (
                <div className="px-3 py-4 text-sm text-gray-400">No messages yet.</div>
              ) : (
                filteredThreads.map((threadRow) => {
                  const isActive = Number(threadRow.threadId) === selectedThreadId;
                  const hasUnread = Boolean(threadRow.hasUnread);
                  return (
                    <button
                      key={threadRow.threadId}
                      type="button"
                      onClick={() => setSelectedThreadId(Number(threadRow.threadId))}
                      className={`tq-mailbox-thread-row w-full text-left px-3 py-2 border-b border-gray-800/80 hover:bg-white/[0.04] transition-colors ${isActive ? "is-active bg-sky-500/10" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-white truncate">{threadRow.subject || "Message"}</div>
                        {hasUnread ? <span className="h-2 w-2 rounded-full bg-sky-400 shrink-0" /> : null}
                      </div>
                      <div className="text-xs text-gray-400 truncate mt-0.5">{threadRow.latestBody}</div>
                      <div className="text-[11px] text-gray-500 mt-1">{formatWhen(threadRow.latestCreatedAt)}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="tq-mailbox-convo rounded-lg border border-gray-700 bg-neutral-900/40 min-h-[420px] flex flex-col">
            <div className="tq-mailbox-strip px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
              {thread ? thread.subject || "Conversation" : "Select a thread"}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {!selectedThreadId ? (
                <div className="text-sm text-gray-400">Select a thread to read messages.</div>
              ) : threadQuery.isLoading ? (
                <div className="text-sm text-gray-400">Loading conversation…</div>
              ) : !messages.length ? (
                <div className="text-sm text-gray-400">No messages in this thread.</div>
              ) : (
                messages.map((message) => {
                  const sentByCurrentUser = Number(message.senderId) === Number(user?.id);
                  return (
                    <div
                      key={message.id}
                      className={`tq-mailbox-msg max-w-[92%] rounded-lg px-3 py-2 ${sentByCurrentUser ? "tq-mailbox-msg-own ml-auto bg-sky-600/20 border border-sky-500/30" : "tq-mailbox-msg-peer mr-auto bg-white/[0.03] border border-white/10"}`}
                    >
                      <div className="text-xs text-gray-400 mb-1">
                        {message.senderUsername || (message.senderId ? "User" : "System")}
                      </div>
                      <MessageBody
                        body={message.body}
                        contentFormat={message.contentFormat}
                        className="text-sm text-white whitespace-pre-wrap break-words"
                      />
                      <div className="text-[11px] text-gray-500 mt-1">{formatWhen(message.createdAt)}</div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={onReplySubmit} className="tq-mailbox-compose border-t border-gray-700 p-3 space-y-2">
              {canReply ? (
                <>
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
                    <span>Reply format</span>
                    <Select
                      value={replyFormat}
                      onValueChange={(value) => setReplyFormat(value as ReplyFormat)}
                    >
                      <SelectTrigger className="tq-mailbox-select-trigger h-7 min-w-[120px] bg-neutral-950 border-gray-700 text-[11px] px-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="tq-mailbox-select-content">
                        <SelectItem className="tq-mailbox-select-item" value="PLAINTEXT">Plain text</SelectItem>
                        <SelectItem className="tq-mailbox-select-item" value="MARKDOWN">Markdown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    placeholder="Write a reply…"
                    className="tq-mailbox-textarea min-h-[84px] bg-neutral-950 border-gray-700 text-white"
                    disabled={!selectedThreadId || replyMutation.isPending || !messagingEnabled}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={!selectedThreadId || !replyBody.trim() || replyMutation.isPending || !messagingEnabled}
                      className="inline-flex items-center gap-2"
                    >
                      <SendHorizontal className="h-4 w-4" />
                      Send Reply
                    </Button>
                  </div>
                </>
              ) : !messagingEnabled ? (
                <div className="text-sm text-gray-400 inline-flex items-center gap-2">
                  <Lock className="h-4 w-4 text-gray-500" />
                  Messaging is currently disabled by admin.
                </div>
              ) : (
                <div className="text-sm text-gray-400 inline-flex items-center gap-2">
                  <Lock className="h-4 w-4 text-gray-500" />
                  Replies are disabled for this thread.
                </div>
              )}
            </form>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
