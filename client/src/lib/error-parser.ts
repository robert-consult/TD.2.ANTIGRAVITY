export type ToastCategory =
  | "ADMIN"
  | "AUTH"
  | "JOURNAL"
  | "VALIDATION"
  | "LIMIT"
  | "EXECUTION"
  | "API"
  | "INFO"
  | "SUCCESS";

export type ToastTone = "error" | "warning" | "info" | "success";
export type ToastVariant = "default" | "destructive";

export type NormalizedPayload = {
  message: string;
  code?: string;
  hint?: string;
  fields?: Record<string, unknown>;
  raw?: unknown;
};

export type ToastMeta = {
  category: ToastCategory;
  tone: ToastTone;
  label: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  badgeText: string;
  borderHex: string;
  shadow: string;
  titleOverride?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeJsonParse(s: string): unknown | undefined {
  const trimmed = s.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function normalizeToastPayload(raw: unknown): NormalizedPayload {
  // Handle empty/null/undefined - don't show error message for missing descriptions
  if (raw === undefined || raw === null || raw === "") {
    return { message: "", raw };
  }

  if (typeof raw === "string") {
    const parsed = safeJsonParse(raw);
    if (isRecord(parsed)) {
      const { message, code, hint, ...rest } = parsed;
      return {
        message: typeof message === "string" ? message : raw,
        code: typeof code === "string" ? code : undefined,
        hint: typeof hint === "string" ? hint : undefined,
        fields: Object.keys(rest).length ? rest : undefined,
        raw,
      };
    }
    return { message: raw, raw };
  }

  if (isRecord(raw)) {
    const msg =
      (typeof raw.message === "string" && raw.message) ||
      (typeof raw.error === "string" && raw.error) ||
      "An unexpected error occurred.";

    return {
      message: msg,
      code: typeof raw.code === "string" ? raw.code : undefined,
      hint: typeof raw.hint === "string" ? raw.hint : undefined,
      fields: Object.keys(raw).length ? raw : undefined,
      raw,
    };
  }

  return { message: "An unexpected error occurred.", raw };
}

function lower(s: string | undefined) {
  return (s || "").toLowerCase();
}

function hasAny(msg: string, re: RegExp) {
  return re.test(msg);
}

function classifySuccess(payload: NormalizedPayload): ToastMeta {
  const msg = lower(payload.message);
  
  if (hasAny(msg, /journal|entry added|entry updated|entry deleted|entry saved/)) {
    return {
      category: "JOURNAL",
      tone: "success",
      label: "JOURNAL",
      icon: "NotebookPen",
      iconColor: "text-cyan-300",
      iconBg: "bg-cyan-500/10",
      badgeText: "text-cyan-300",
      borderHex: "#22D3EE",
      shadow: "shadow-[0_0_24px_rgba(34,211,238,0.14)]",
    };
  }

  if (hasAny(msg, /admin|user disabled|user enabled|account frozen|account unfrozen|impersonation|view as/)) {
    return {
      category: "ADMIN",
      tone: "success",
      label: "ADMIN",
      icon: "ShieldCheck",
      iconColor: "text-purple-300",
      iconBg: "bg-purple-500/10",
      badgeText: "text-purple-300",
      borderHex: "#A855F7",
      shadow: "shadow-[0_0_24px_rgba(168,85,247,0.14)]",
    };
  }

  if (hasAny(msg, /registration successful|account.*created|logged in|welcome/)) {
    return {
      category: "AUTH",
      tone: "success",
      label: "IDENTITY",
      icon: "UserCheck",
      iconColor: "text-indigo-300",
      iconBg: "bg-indigo-500/10",
      badgeText: "text-indigo-300",
      borderHex: "#6366F1",
      shadow: "shadow-[0_0_24px_rgba(99,102,241,0.14)]",
    };
  }

  if (hasAny(msg, /trade.*executed|order.*filled|position.*opened|order.*placed/)) {
    return {
      category: "SUCCESS",
      tone: "success",
      label: "TRADE",
      icon: "CheckCircle",
      iconColor: "text-green-300",
      iconBg: "bg-green-500/10",
      badgeText: "text-green-300",
      borderHex: "#22C55E",
      shadow: "shadow-[0_0_24px_rgba(34,197,94,0.14)]",
    };
  }

  return {
    category: "SUCCESS",
    tone: "success",
    label: "SUCCESS",
    icon: "CheckCircle",
    iconColor: "text-green-300",
    iconBg: "bg-green-500/10",
    badgeText: "text-green-300",
    borderHex: "#22C55E",
    shadow: "shadow-[0_0_24px_rgba(34,197,94,0.14)]",
  };
}

function classifyInfo(payload: NormalizedPayload): ToastMeta {
  return {
    category: "INFO",
    tone: "info",
    label: "INFO",
    icon: "Info",
    iconColor: "text-blue-300",
    iconBg: "bg-blue-500/10",
    badgeText: "text-blue-300",
    borderHex: "#3B82F6",
    shadow: "shadow-[0_0_24px_rgba(59,130,246,0.14)]",
  };
}

function classify(payload: NormalizedPayload, variant?: ToastVariant): ToastMeta {
  const msg = lower(payload.message);
  const code = lower(payload.code);

  if (variant !== "destructive") {
    const successKeywords = /success|completed|saved|created|updated|deleted|enabled|disabled|frozen|unfrozen|started|restored|executed|filled|opened|placed/;
    if (hasAny(msg, successKeywords)) {
      return classifySuccess(payload);
    }
    return classifyInfo(payload);
  }

  if (hasAny(code, /impersonation/) || hasAny(msg, /viewing as another user|view as|impersonation|write operations are disabled/)) {
    return {
      category: "ADMIN",
      tone: "error",
      label: "ADMIN / SECURITY",
      icon: "ShieldAlert",
      iconColor: "text-purple-300",
      iconBg: "bg-purple-500/10",
      badgeText: "text-purple-300",
      borderHex: "#A855F7",
      shadow: "shadow-[0_0_24px_rgba(168,85,247,0.14)]",
      titleOverride: "Action Restricted",
    };
  }

  if (hasAny(msg, /login failed|invalid email|invalid password|registration failed|password|email may already be in use/)) {
    return {
      category: "AUTH",
      tone: "error",
      label: "IDENTITY",
      icon: "Lock",
      iconColor: "text-indigo-300",
      iconBg: "bg-indigo-500/10",
      badgeText: "text-indigo-300",
      borderHex: "#6366F1",
      shadow: "shadow-[0_0_24px_rgba(99,102,241,0.14)]",
      titleOverride: "Authentication Failed",
    };
  }

  if (hasAny(msg, /journal|entry|note must be at least|failed to create entry|failed to update entry|failed to delete entry|characters/)) {
    return {
      category: "JOURNAL",
      tone: "error",
      label: "JOURNAL",
      icon: "NotebookPen",
      iconColor: "text-cyan-300",
      iconBg: "bg-cyan-500/10",
      badgeText: "text-cyan-300",
      borderHex: "#22D3EE",
      shadow: "shadow-[0_0_24px_rgba(34,211,238,0.14)]",
      titleOverride: "Journal Error",
    };
  }

  if (hasAny(msg, /failed to update user status|failed to freeze|failed to unfreeze|failed to start impersonation|failed to update users|admin/)) {
    return {
      category: "ADMIN",
      tone: "error",
      label: "ADMIN",
      icon: "ShieldAlert",
      iconColor: "text-purple-300",
      iconBg: "bg-purple-500/10",
      badgeText: "text-purple-300",
      borderHex: "#A855F7",
      shadow: "shadow-[0_0_24px_rgba(168,85,247,0.14)]",
      titleOverride: "Admin Action Failed",
    };
  }

  if (hasAny(msg, /maximum .*concurrent|concurrent lots exceeded|max concurrent|limit=\d+|open \+ pending/)) {
    return {
      category: "LIMIT",
      tone: "warning",
      label: "RISK GUARDRAIL",
      icon: "Gauge",
      iconColor: "text-amber-300",
      iconBg: "bg-amber-500/10",
      badgeText: "text-amber-300",
      borderHex: "#FBBF24",
      shadow: "shadow-[0_0_24px_rgba(251,191,36,0.14)]",
      titleOverride: "Order Blocked",
    };
  }

  if (hasAny(msg, /symbol configurations missing|symbol not found|invalid lot size|current price is not available|valid limit price|valid stop price|invalid order type|configuration/)) {
    return {
      category: "VALIDATION",
      tone: "warning",
      label: "VALIDATION",
      icon: "Zap",
      iconColor: "text-amber-300",
      iconBg: "bg-amber-500/10",
      badgeText: "text-amber-300",
      borderHex: "#FBBF24",
      shadow: "shadow-[0_0_24px_rgba(251,191,36,0.14)]",
      titleOverride: "Check Your Inputs",
    };
  }

  if (hasAny(msg, /failed to place trade|failed to close trade|failed to cancel order|failed to update trade targets/)) {
    return {
      category: "API",
      tone: "error",
      label: "SYSTEM",
      icon: "Database",
      iconColor: "text-rose-300",
      iconBg: "bg-rose-500/10",
      badgeText: "text-rose-300",
      borderHex: "#FB7185",
      shadow: "shadow-[0_0_24px_rgba(251,113,133,0.14)]",
      titleOverride: "System Error",
    };
  }

  if (hasAny(msg, /email|verification.*email|wait before requesting|daily.*limit|reverify|verify your email/)) {
    return {
      category: "AUTH",
      tone: "warning",
      label: "EMAIL",
      icon: "Mail",
      iconColor: "text-indigo-300",
      iconBg: "bg-indigo-500/10",
      badgeText: "text-indigo-300",
      borderHex: "#6366F1",
      shadow: "shadow-[0_0_24px_rgba(99,102,241,0.14)]",
      titleOverride: "Email Verification",
    };
  }

  if (hasAny(msg, /captcha|human|bot|verification.*complete|complete.*verification|couldn't verify/)) {
    return {
      category: "AUTH",
      tone: "error",
      label: "NO BOTs",
      icon: "ShieldAlert",
      iconColor: "text-orange-300",
      iconBg: "bg-orange-500/10",
      badgeText: "text-orange-300",
      borderHex: "#F97316",
      shadow: "shadow-[0_0_24px_rgba(249,115,22,0.14)]",
      titleOverride: "Complete Verification",
    };
  }

  return {
    category: "EXECUTION",
    tone: "error",
    label: "TRADE",
    icon: "AlertTriangle",
    iconColor: "text-red-300",
    iconBg: "bg-red-500/10",
    badgeText: "text-red-300",
    borderHex: "#F87171",
    shadow: "shadow-[0_0_24px_rgba(248,113,113,0.14)]",
    titleOverride: "Trade Failed",
  };
}

function formatMetricRow(fields?: Record<string, unknown>): string | null {
  if (!fields) return null;

  const pickNum = (k: string) => {
    const v = fields[k];
    return typeof v === "number" ? v : (typeof v === "string" && !Number.isNaN(Number(v)) ? Number(v) : null);
  };

  const currentLots = pickNum("currentLots");
  const requestedLots = pickNum("requestedLots");
  const limit = pickNum("limit");

  if (currentLots !== null && requestedLots !== null && limit !== null) {
    const total = currentLots + requestedLots;
    const overBy = total - limit;
    const overTxt = overBy > 0 ? ` • Over by ${overBy}` : "";
    return `Current ${currentLots} • Requested ${requestedLots} • Max ${limit}${overTxt}`;
  }

  const activeTrades = pickNum("activeTrades");
  if (activeTrades !== null && limit !== null) {
    return `Active ${activeTrades} • Max ${limit}`;
  }

  const activePerSymbol = pickNum("activePerSymbol");
  const symbolId = fields["symbolId"];
  if (activePerSymbol !== null && limit !== null) {
    const symTxt = symbolId !== undefined ? `Symbol ${String(symbolId)} • ` : "";
    return `${symTxt}Active ${activePerSymbol} • Max ${limit}`;
  }

  return null;
}

export function buildToastView(rawDescription: unknown, rawTitle?: unknown, variant?: ToastVariant) {
  const payload = normalizeToastPayload(rawDescription);
  const meta = classify(payload, variant);

  const incomingTitle = typeof rawTitle === "string" ? rawTitle : undefined;
  const title =
    variant === "destructive" && (!incomingTitle || incomingTitle.trim().toLowerCase() === "error" || incomingTitle.trim().toLowerCase() === "trade failed")
      ? (meta.titleOverride || incomingTitle || "Notification")
      : (incomingTitle || meta.titleOverride || "Notification");

  const metrics = formatMetricRow(payload.fields);

  return { payload, meta, title, metrics };
}
