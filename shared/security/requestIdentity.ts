type RequestLike = {
  headers?: Record<string, unknown>;
  ip?: unknown;
  socket?: { remoteAddress?: unknown } | null;
};

export function normalizeIpKey(input: string | null | undefined): string | null {
  if (!input) return null;
  let ip = String(input).trim();
  if (!ip) return null;
  if (ip.includes(",")) ip = ip.split(",")[0]!.trim();
  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice("::ffff:".length);

  const bracket = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket?.[1]) ip = bracket[1];

  const ipv4Port = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4Port?.[1]) ip = ipv4Port[1];

  return ip.trim().toLowerCase() || null;
}

export function readRequestHeader(req: RequestLike, name: string): string | undefined {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (!value) return undefined;
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value);
}

export function cleanRequestString(value: string | undefined, maxLen: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

export function parseForwardedForHeader(value: string | undefined): string[] {
  if (!value) return [];
  const forMatches = value.match(/for=([^;,\s]+)/gi);
  if (!forMatches) return [];
  return forMatches
    .map((part) => part.replace(/for=/i, "").replace(/"/g, "").trim())
    .filter(Boolean);
}

export function isPrivateOrLoopbackIp(ip: string): boolean {
  const key = normalizeIpKey(ip) ?? ip;
  if (!key) return true;
  if (key === "::1") return true;
  if (key.startsWith("fe80:")) return true;
  if (key.startsWith("fc") || key.startsWith("fd")) return true;

  const m = key.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function getClientIpFromRequest(req: RequestLike): string | null {
  const candidates: string[] = [];

  const cfIp = readRequestHeader(req, "cf-connecting-ip");
  if (cfIp) candidates.push(cfIp);

  const trueClientIp = readRequestHeader(req, "true-client-ip") ?? readRequestHeader(req, "x-client-ip");
  if (trueClientIp) candidates.push(trueClientIp);

  const xForwardedFor = readRequestHeader(req, "x-forwarded-for");
  if (xForwardedFor) {
    candidates.push(
      ...xForwardedFor
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }

  const forwarded = readRequestHeader(req, "forwarded");
  if (forwarded) {
    candidates.push(...parseForwardedForHeader(forwarded));
  }

  const xRealIp = readRequestHeader(req, "x-real-ip");
  if (xRealIp) candidates.push(xRealIp);

  if (req.ip) candidates.push(String(req.ip));
  if (req.socket?.remoteAddress) candidates.push(String(req.socket.remoteAddress));

  const normalized = candidates
    .map((ip) => normalizeIpKey(ip))
    .filter(Boolean) as string[];

  if (normalized.length === 0) return candidates[0] ?? null;
  const publicIp = normalized.find((ip) => !isPrivateOrLoopbackIp(ip));
  return publicIp || normalized[0] || candidates[0] || null;
}

export function getUserAgentFromRequest(req: RequestLike): string | null {
  const ua = cleanRequestString(readRequestHeader(req, "user-agent"), 512);
  if (ua) return ua;

  const chUa = cleanRequestString(readRequestHeader(req, "sec-ch-ua"), 512);
  const platform = cleanRequestString(readRequestHeader(req, "sec-ch-ua-platform"), 128);
  const mobile = cleanRequestString(readRequestHeader(req, "sec-ch-ua-mobile"), 16);
  const fallback = [chUa, platform ? `platform=${platform}` : null, mobile ? `mobile=${mobile}` : null]
    .filter(Boolean)
    .join(" ");
  return fallback || null;
}
