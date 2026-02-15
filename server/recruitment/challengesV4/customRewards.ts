export type CustomRewardTrigger = "ON_ENROLL" | "ON_PHASE_PASS" | "ON_CHALLENGE_PASS" | "ON_RANK_TOP_N";
export type CustomRewardActionType = "BADGE_AWARD" | "SELECTION_BOOST" | "INBOX_MESSAGE" | "NOTIFY";

export type CustomRewardRule = {
  rewardKey: string;
  trigger: CustomRewardTrigger;
  actionType: CustomRewardActionType;
  topN: number | null;
  payload: Record<string, unknown>;
};

const TRIGGERS = new Set<CustomRewardTrigger>(["ON_ENROLL", "ON_PHASE_PASS", "ON_CHALLENGE_PASS", "ON_RANK_TOP_N"]);
const ACTIONS = new Set<CustomRewardActionType>(["BADGE_AWARD", "SELECTION_BOOST", "INBOX_MESSAGE", "NOTIFY"]);

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseRaw(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeTrigger(value: unknown): CustomRewardTrigger | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (TRIGGERS.has(raw as CustomRewardTrigger)) return raw as CustomRewardTrigger;
  return null;
}

function normalizeActionType(value: unknown): CustomRewardActionType | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (ACTIONS.has(raw as CustomRewardActionType)) return raw as CustomRewardActionType;
  return null;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function toRewardArray(raw: unknown): unknown[] {
  const parsed = parseRaw(raw);
  if (Array.isArray(parsed)) return parsed;
  const obj = toObject(parsed);
  if (Array.isArray(obj.rewards)) return obj.rewards;
  if (obj.trigger || obj.actionType || obj.action) return [obj];
  return [];
}

export function parseCustomRewardRules(raw: unknown): CustomRewardRule[] {
  const rows = toRewardArray(raw);
  const rules: CustomRewardRule[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = toObject(rows[i]);
    const enabled = row.enabled !== false && row.isEnabled !== false;
    if (!enabled) continue;

    const trigger = normalizeTrigger(row.trigger ?? row.event ?? row.when);
    const actionType = normalizeActionType(row.actionType ?? row.action ?? row.kind);
    if (!trigger || !actionType) continue;

    const rewardKeyRaw = String(row.rewardKey ?? row.key ?? row.id ?? `${trigger}_${actionType}_${i + 1}`).trim();
    const rewardKey = rewardKeyRaw.slice(0, 120);
    if (!rewardKey) continue;

    const payloadSeed = toObject(row.payload);
    const payload: Record<string, unknown> = { ...payloadSeed };

    if (actionType === "BADGE_AWARD") {
      payload.badgeRef ??= row.badgeRef ?? row.badgeKey ?? row.badgeId ?? null;
      payload.reason ??= row.reason ?? null;
    } else if (actionType === "SELECTION_BOOST") {
      payload.points ??= row.points ?? row.boostPoints ?? row.value ?? null;
      payload.reason ??= row.reason ?? null;
    } else if (actionType === "INBOX_MESSAGE") {
      payload.subject ??= row.subject ?? null;
      payload.body ??= row.body ?? row.message ?? null;
      payload.category ??= row.category ?? null;
    } else if (actionType === "NOTIFY") {
      payload.title ??= row.title ?? null;
      payload.message ??= row.message ?? row.body ?? null;
      payload.severity ??= row.severity ?? null;
      payload.link ??= row.link ?? null;
      payload.sourceEvent ??= row.sourceEvent ?? null;
    }

    const topNSource = row.topN ?? row.rankTopN ?? row.maxRank ?? toObject(row.triggerArgs).topN;
    const topN = trigger === "ON_RANK_TOP_N" ? Math.max(1, Math.min(1000, toPositiveInt(topNSource, 3))) : null;

    rules.push({
      rewardKey,
      trigger,
      actionType,
      topN,
      payload,
    });
  }

  return rules;
}

export function scopedCustomRewardKey(args: {
  rewardKey: string;
  trigger: CustomRewardTrigger;
  phaseNumber?: number | null;
}): string {
  const base = String(args.rewardKey || "").trim().slice(0, 120);
  if (!base) return "reward";
  if (args.trigger !== "ON_PHASE_PASS") return base;
  const phase = Number(args.phaseNumber ?? 0);
  if (!Number.isFinite(phase) || phase <= 0) return base;
  return `${base}:phase:${Math.trunc(phase)}`.slice(0, 160);
}

