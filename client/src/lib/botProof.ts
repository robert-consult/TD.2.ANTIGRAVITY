export type BotChallengePayload = {
  id: string;
  serverNonce: string;
  difficulty: number; // leading zero bits required
  expiresAt: number; // unix seconds
};

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

function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (let i = 0; i < hex.length; i++) {
    const v = parseInt(hex[i]!, 16);
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

export async function solveBotChallenge(ch: BotChallengePayload, identity: Record<string, string>): Promise<string> {
  const deviceFp = identity["x-device-fp"] || "";
  const deviceInstallId = identity["x-device-install-id"] || "";

  const start = Date.now();
  let nonce = 0;

  // Guardrails so we don't hang
  const maxMs = 2500;
  const yieldEvery = 250;

  while (Date.now() - start < maxMs) {
    const material = `${ch.id}|${ch.serverNonce}|${nonce}|${deviceFp}|${deviceInstallId}`;
    const digest = await sha256Hex(material);
    if (leadingZeroBits(digest) >= ch.difficulty) {
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

