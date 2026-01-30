export function normalizeSymbol(input: string): string {
  return String(input ?? "").replace("/", "").trim().toUpperCase();
}

function formatSymbolForForgeApi(symbol: string): string | null {
  const s = normalizeSymbol(symbol);
  if (!s) return null;

  // Prefer explicit provider codes where they differ from our internal symbols.
  const mapped: Record<string, string> = {
    XAUUSD: "XAU/USD",
    XAGUSD: "XAG/USD",
    US30: "USA30",
    NGAS: "NATGAS",
    WTI: "USOIL",
  };
  if (mapped[s]) return mapped[s];

  // Forex/metal/crypto pairs (e.g., EURUSD -> EUR/USD). Only apply when the symbol is 6 letters;
  // this avoids mangling index codes like NAS100/SPX500.
  if (/^[A-Z]{6}$/.test(s)) return `${s.slice(0, 3)}/${s.slice(3, 6)}`;

  return s;
}

/**
 * Formats internal symbols to the 1Forge `pairs` query string.
 * We only include pair-style symbols (contain "/") to avoid sending unsupported/non-pair codes.
 */
export function formatSymbolsForForgeAPI(symbols: string[]): string {
  const formatted = symbols
    .map(formatSymbolForForgeApi)
    .filter((s): s is string => Boolean(s))
    .filter((s) => s.includes("/"));
  return [...new Set(formatted)].join(",");
}

/**
 * 1Forge sometimes returns non-array payloads like `{ error: true, message: "..." }`.
 */
export function extractForgeErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as any;
  const message = typeof rec.message === "string" ? rec.message.trim() : "";
  if (message) return message;
  const errorText = typeof rec.error === "string" ? rec.error.trim() : "";
  if (errorText) return errorText;
  if (rec.error === true) return "1Forge error";
  return null;
}

