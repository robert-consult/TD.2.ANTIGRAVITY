type ErrorSummaryOptions = {
  includeStack?: boolean;
  maxLen?: number;
};

const SECRET_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // Authorization headers / bearer tokens
  { re: /(authorization["']?\s*[:=]\s*["']?\s*bearer\s+)[a-z0-9._~+/\-=]+/gi, replacement: "$1[REDACTED]" },
  { re: /(bearer\s+)[a-z0-9._~+/\-=]+/gi, replacement: "$1[REDACTED]" },
  // API key-like values in json/text
  { re: /((?:api|secret|token|password|key)[^:=]{0,24}[:=]\s*["']?)[^"'\s,;]+/gi, replacement: "$1[REDACTED]" },
  // OpenAI style keys
  { re: /\bsk-[a-z0-9]{16,}\b/gi, replacement: "[REDACTED_OPENAI_KEY]" },
  // JWT-ish triplets
  { re: /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9._-]{8,}\.[a-zA-Z0-9._-]{8,}\b/g, replacement: "[REDACTED_JWT]" },
  // Long high-entropy blobs that are often secrets
  { re: /\b[a-z0-9+/_-]{48,}\b/gi, replacement: "[REDACTED_TOKEN]" },
];

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 1))}…`;
}

function toStringSafe(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return value.stack || value.message || value.name || "Error";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sanitizeLogText(value: unknown, maxLen = 600): string {
  let text = toStringSafe(value);
  for (const { re, replacement } of SECRET_PATTERNS) {
    text = text.replace(re, replacement);
  }
  return truncate(text, maxLen);
}

export function sanitizeExternalErrorText(value: unknown, maxLen = 280): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let normalized = raw;
  try {
    const parsed = JSON.parse(raw);
    const err = (parsed as any)?.error ?? parsed;
    if (err && typeof err === "object") {
      const parts: string[] = [];
      if (typeof (err as any).type === "string") parts.push(`type=${String((err as any).type)}`);
      if (typeof (err as any).code === "string") parts.push(`code=${String((err as any).code)}`);
      if (typeof (err as any).message === "string") parts.push(String((err as any).message));
      if (parts.length > 0) normalized = parts.join(" | ");
    }
  } catch {
    // Keep plain-text response when it is not JSON.
  }
  return sanitizeLogText(normalized, maxLen);
}

export function summarizeErrorForLog(error: unknown, opts: ErrorSummaryOptions = {}): string {
  const includeStack = opts.includeStack !== false;
  const maxLen = Number.isFinite(opts.maxLen) ? Math.max(80, Math.trunc(opts.maxLen!)) : 1200;

  if (error instanceof Error) {
    if (includeStack && error.stack) {
      return sanitizeLogText(error.stack, maxLen);
    }
    return sanitizeLogText(`${error.name}: ${error.message}`, maxLen);
  }
  return sanitizeLogText(error, maxLen);
}
