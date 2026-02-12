export const BOT_CHALLENGE_REQUIRED_CODE = "BOT_CHALLENGE_REQUIRED";

export const BOT_PROOF_MAX_SOLVE_MS = 2500;
export const BOT_PROOF_YIELD_EVERY = 250;

export type BotChallengePayload = {
  id: string;
  serverNonce: string;
  difficulty: number;
  expiresAt: number; // unix seconds
};

export type BotProofToken = {
  id: string;
  solutionNonce: number;
  ts: number;
  deviceFp?: string;
  deviceInstallId?: string;
  digest: string;
};

export function leadingZeroBitsOfHex(hex: string): number {
  let bits = 0;
  for (let i = 0; i < hex.length; i += 1) {
    const v = Number.parseInt(hex[i]!, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    if (v < 8) bits += 1;
    if (v < 4) bits += 1;
    if (v < 2) bits += 1;
    return bits;
  }
  return bits;
}
