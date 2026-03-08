import { db } from "@db";
import { communicationSettings } from "@shared/schema";
import { clampIntOr, nowSec } from "@shared/scalars";
import { eq } from "drizzle-orm";
import { publishLiveEvent } from "./liveBus";

const COMM_SETTINGS_CACHE_TTL_MS = 5000;
const LARGE_TARGET_THRESHOLD_MIN = 1;
const LARGE_TARGET_THRESHOLD_MAX = 20000;
const RECIPIENTS_MAX_HARD_LIMIT = 200000;
const ASYNC_FANOUT_THRESHOLD_MIN = 1;
const ASYNC_FANOUT_THRESHOLD_MAX = 50000;
const FANOUT_BATCH_MIN = 50;
const FANOUT_BATCH_MAX = 5000;

export type CommunicationSettingsResolved = {
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
  notificationChallengeEnabled: boolean;
  updatedAt: number;
  updatedBy: string | null;
};

export type CommunicationSettingsPatch = Partial<
  Omit<CommunicationSettingsResolved, "id" | "updatedAt" | "updatedBy">
>;

let communicationSettingsCache: CommunicationSettingsResolved | null = null;
let communicationSettingsCacheAtMs = 0;
let communicationSettingsLoadPromise: Promise<CommunicationSettingsResolved> | null = null;

function normalizeCommunicationSettings(
  row: Partial<CommunicationSettingsResolved> | null | undefined,
): CommunicationSettingsResolved {
  const maxRecipients = clampIntOr(
    row?.messagingMaxRecipientsPerSend,
    10000,
    LARGE_TARGET_THRESHOLD_MIN,
    RECIPIENTS_MAX_HARD_LIMIT,
  );
  const largeTargetThreshold = Math.min(
    maxRecipients,
    clampIntOr(
      row?.messagingLargeTargetThreshold,
      100,
      LARGE_TARGET_THRESHOLD_MIN,
      LARGE_TARGET_THRESHOLD_MAX,
    ),
  );
  const asyncFanoutThreshold = Math.min(
    maxRecipients,
    clampIntOr(
      row?.messagingAsyncFanoutThreshold,
      200,
      ASYNC_FANOUT_THRESHOLD_MIN,
      ASYNC_FANOUT_THRESHOLD_MAX,
    ),
  );
  const fanoutBatchSize = Math.min(
    maxRecipients,
    clampIntOr(row?.messagingFanoutBatchSize, 500, FANOUT_BATCH_MIN, FANOUT_BATCH_MAX),
  );
  const updatedByRaw = typeof row?.updatedBy === "string" ? row.updatedBy.trim() : "";
  const messagingE2eeEnabled = Boolean(row?.messagingE2eeEnabled ?? false);
  const notificationE2eeEnabled = Boolean(row?.notificationE2eeEnabled ?? false);

  return {
    id: 1,
    messagingEnabled: Boolean(row?.messagingEnabled ?? true),
    messagingAllowReplyByDefault: Boolean(row?.messagingAllowReplyByDefault ?? false),
    messagingAllowBroadcastReplies: Boolean(row?.messagingAllowBroadcastReplies ?? false),
    messagingLargeTargetThreshold: largeTargetThreshold,
    messagingMaxRecipientsPerSend: maxRecipients,
    messagingAsyncFanoutThreshold: asyncFanoutThreshold,
    messagingFanoutBatchSize: fanoutBatchSize,
    messagingAutoWelcomeEnabled: Boolean(row?.messagingAutoWelcomeEnabled ?? true),
    messagingAccountStatusMailboxEnabled: Boolean(row?.messagingAccountStatusMailboxEnabled ?? true),
    messagingKycMailboxEnabled: Boolean(row?.messagingKycMailboxEnabled ?? true),
    messagingE2eeEnabled,
    messagingE2eeRequired: messagingE2eeEnabled && Boolean(row?.messagingE2eeRequired ?? false),
    notificationsEnabled: Boolean(row?.notificationsEnabled ?? true),
    notificationRealtimeEnabled: Boolean(row?.notificationRealtimeEnabled ?? true),
    notificationSoundDefaultEnabled: Boolean(row?.notificationSoundDefaultEnabled ?? true),
    notificationE2eeEnabled,
    notificationE2eeRequired: notificationE2eeEnabled && Boolean(row?.notificationE2eeRequired ?? false),
    notificationTradePendingFillEnabled: Boolean(row?.notificationTradePendingFillEnabled ?? true),
    notificationTradeTakeProfitEnabled: Boolean(row?.notificationTradeTakeProfitEnabled ?? true),
    notificationTradeStopLossEnabled: Boolean(row?.notificationTradeStopLossEnabled ?? true),
    notificationTradeMaxHoldEnabled: Boolean(row?.notificationTradeMaxHoldEnabled ?? true),
    notificationAccountFreezeEnabled: Boolean(row?.notificationAccountFreezeEnabled ?? true),
    notificationAccountUnfreezeEnabled: Boolean(row?.notificationAccountUnfreezeEnabled ?? true),
    notificationKycUpdatesEnabled: Boolean(row?.notificationKycUpdatesEnabled ?? true),
    notificationChallengeEnabled: Boolean(row?.notificationChallengeEnabled ?? true),
    updatedAt: clampIntOr(row?.updatedAt, nowSec(), 1, 4_102_444_800),
    updatedBy: updatedByRaw ? updatedByRaw.slice(0, 160) : null,
  };
}

function toCommunicationSettingsWritableValues(settings: CommunicationSettingsResolved) {
  return {
    messagingEnabled: settings.messagingEnabled,
    messagingAllowReplyByDefault: settings.messagingAllowReplyByDefault,
    messagingAllowBroadcastReplies: settings.messagingAllowBroadcastReplies,
    messagingLargeTargetThreshold: settings.messagingLargeTargetThreshold,
    messagingMaxRecipientsPerSend: settings.messagingMaxRecipientsPerSend,
    messagingAsyncFanoutThreshold: settings.messagingAsyncFanoutThreshold,
    messagingFanoutBatchSize: settings.messagingFanoutBatchSize,
    messagingAutoWelcomeEnabled: settings.messagingAutoWelcomeEnabled,
    messagingAccountStatusMailboxEnabled: settings.messagingAccountStatusMailboxEnabled,
    messagingKycMailboxEnabled: settings.messagingKycMailboxEnabled,
    messagingE2eeEnabled: settings.messagingE2eeEnabled,
    messagingE2eeRequired: settings.messagingE2eeRequired,
    notificationsEnabled: settings.notificationsEnabled,
    notificationRealtimeEnabled: settings.notificationRealtimeEnabled,
    notificationSoundDefaultEnabled: settings.notificationSoundDefaultEnabled,
    notificationE2eeEnabled: settings.notificationE2eeEnabled,
    notificationE2eeRequired: settings.notificationE2eeRequired,
    notificationTradePendingFillEnabled: settings.notificationTradePendingFillEnabled,
    notificationTradeTakeProfitEnabled: settings.notificationTradeTakeProfitEnabled,
    notificationTradeStopLossEnabled: settings.notificationTradeStopLossEnabled,
    notificationTradeMaxHoldEnabled: settings.notificationTradeMaxHoldEnabled,
    notificationAccountFreezeEnabled: settings.notificationAccountFreezeEnabled,
    notificationAccountUnfreezeEnabled: settings.notificationAccountUnfreezeEnabled,
    notificationKycUpdatesEnabled: settings.notificationKycUpdatesEnabled,
    notificationChallengeEnabled: settings.notificationChallengeEnabled,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

function setCommunicationSettingsCache(settings: CommunicationSettingsResolved) {
  communicationSettingsCache = settings;
  communicationSettingsCacheAtMs = Date.now();
}

async function loadCommunicationSettingsFromDb(): Promise<CommunicationSettingsResolved> {
  const [existing] = await db
    .select()
    .from(communicationSettings)
    .where(eq(communicationSettings.id, 1))
    .limit(1);

  if (existing) {
    return normalizeCommunicationSettings(existing as any);
  }

  const timestamp = nowSec();
  const [inserted] = await db
    .insert(communicationSettings)
    .values({ id: 1, updatedAt: timestamp })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    return normalizeCommunicationSettings(inserted as any);
  }

  const [refetched] = await db
    .select()
    .from(communicationSettings)
    .where(eq(communicationSettings.id, 1))
    .limit(1);
  return normalizeCommunicationSettings(refetched as any);
}

export function invalidateCommunicationSettingsCache() {
  communicationSettingsCache = null;
  communicationSettingsCacheAtMs = 0;
}

export async function getCommunicationSettings(options?: {
  force?: boolean;
}): Promise<CommunicationSettingsResolved> {
  const force = Boolean(options?.force);
  const isFresh =
    communicationSettingsCache !== null &&
    Date.now() - communicationSettingsCacheAtMs < COMM_SETTINGS_CACHE_TTL_MS;
  if (!force && isFresh && communicationSettingsCache) {
    return communicationSettingsCache;
  }

  if (!force && communicationSettingsLoadPromise) {
    return communicationSettingsLoadPromise;
  }

  communicationSettingsLoadPromise = (async () => {
    const loaded = await loadCommunicationSettingsFromDb();
    setCommunicationSettingsCache(loaded);
    return loaded;
  })();

  try {
    return await communicationSettingsLoadPromise;
  } finally {
    communicationSettingsLoadPromise = null;
  }
}

export async function updateCommunicationSettings(input: {
  patch: CommunicationSettingsPatch;
  updatedBy?: string | null;
}): Promise<CommunicationSettingsResolved> {
  const patch = (input.patch ?? {}) as CommunicationSettingsPatch;
  const current = await getCommunicationSettings({ force: true });
  const timestamp = nowSec();
  const updatedByRaw = typeof input.updatedBy === "string" ? input.updatedBy.trim() : "";
  const next = normalizeCommunicationSettings({
    ...current,
    ...patch,
    updatedAt: timestamp,
    updatedBy: updatedByRaw ? updatedByRaw : current.updatedBy,
  });
  const values = toCommunicationSettingsWritableValues(next);

  const [saved] = await db
    .insert(communicationSettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({
      target: communicationSettings.id,
      set: values,
    })
    .returning();

  const resolved = normalizeCommunicationSettings((saved as any) ?? { id: 1, ...values });
  setCommunicationSettingsCache(resolved);

  publishLiveEvent({
    type: "communications:config-updated",
    payload: {
      updatedAt: resolved.updatedAt,
    },
  });

  return resolved;
}
