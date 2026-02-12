import {
  BOT_PROOF_MAX_SOLVE_MS,
  BOT_PROOF_YIELD_EVERY,
  BotChallengePayload,
  leadingZeroBitsOfHex,
} from "@shared/security/botChallenge";
import { IDENTITY_HEADER_DEVICE_FP, IDENTITY_HEADER_DEVICE_INSTALL_ID } from "@shared/identity/headers";

function b64urlEncodeUtf8(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function solveBotChallenge(ch: BotChallengePayload, identity: Record<string, string>): Promise<string> {
  const deviceFp = identity[IDENTITY_HEADER_DEVICE_FP] || "";
  const deviceInstallId = identity[IDENTITY_HEADER_DEVICE_INSTALL_ID] || "";

  const start = Date.now();
  let nonce = 0;

  // Guardrails so we don't hang
  const maxMs = BOT_PROOF_MAX_SOLVE_MS;
  const yieldEvery = BOT_PROOF_YIELD_EVERY;

  while (Date.now() - start < maxMs) {
    const material = `${ch.id}|${ch.serverNonce}|${nonce}|${deviceFp}|${deviceInstallId}`;
    const digest = await sha256Hex(material);
    if (leadingZeroBitsOfHex(digest) >= ch.difficulty) {
      const tokenObj = {
        id: ch.id,
        solutionNonce: nonce,
        ts: Math.floor(Date.now() / 1000),
        deviceFp: deviceFp || undefined,
        deviceInstallId: deviceInstallId || undefined,
        digest,
      };
      return b64urlEncodeUtf8(JSON.stringify(tokenObj));
    }
    nonce++;
    if (nonce % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
  }

  throw new Error("BOT_PROOF_TIMEOUT");
}
