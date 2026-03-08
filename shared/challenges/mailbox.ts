export const CHALLENGE_MAILBOX_CATEGORIES = [
  "SYSTEM",
  "SUPPORT",
  "ANNOUNCEMENT",
  "CHALLENGES",
] as const;

export type ChallengeMailboxCategory = (typeof CHALLENGE_MAILBOX_CATEGORIES)[number];

export function normalizeChallengeMailboxCategory(raw: unknown): ChallengeMailboxCategory {
  const value = String(raw ?? "").trim().toUpperCase();
  return CHALLENGE_MAILBOX_CATEGORIES.includes(value as ChallengeMailboxCategory)
    ? (value as ChallengeMailboxCategory)
    : "SYSTEM";
}
