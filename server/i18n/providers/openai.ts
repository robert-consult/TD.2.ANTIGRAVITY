import { createHash } from "node:crypto";
import { applyGlossary } from "../glossary";
import { sanitizeExternalErrorText } from "../../security/logSanitizer";

type OpenAiTranslateItem = { id: string; text: string };

const PLACEHOLDER_RE =
  /\{\{[a-zA-Z0-9_]+\}\}|%\{[a-zA-Z0-9_]+\}|\$\{[a-zA-Z0-9_.]+\}|\{[a-zA-Z0-9_]+\}/g;

function baseLocale(locale: string): string {
  return String(locale || "")
    .trim()
    .toLowerCase()
    .split("-")[0] || "en";
}

function looksSwedish(text: string): boolean {
  const s = String(text || "").toLowerCase();
  if (!s) return false;
  if (/[åäö]/.test(s)) return true;

  const strongSignals = [
    "handels",
    "handel",
    "inställ",
    "spara",
    "slutförd",
    "rekommendation",
    "vänligen",
    "måste",
    "ställt",
    "ställ",
    "kör",
    "lång",
    "kort",
    "senaste",
    "förlust",
    "lönsam",
    "sväng",
    "lärdom",
    "dödlägen",
    "köp",
    "sälj",
  ];
  for (const w of strongSignals) {
    if (new RegExp(`\\b${w}`, "i").test(s)) return true;
  }

  const stopwords = [
    "och",
    "att",
    "för",
    "inte",
    "det",
    "den",
    "som",
    "med",
    "till",
    "från",
    "dina",
    "din",
    "du",
    "vi",
    "är",
    "kan",
    "ska",
  ];
  const hits = stopwords.reduce((n, w) => (new RegExp(`\\b${w}\\b`, "i").test(s) ? n + 1 : n), 0);
  return hits >= 2;
}

function hasLatinDiacritics(text: string): boolean {
  return /[àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿćčđğħıļńőśşšţțűž]/i.test(String(text || ""));
}

function looksAlbanian(text: string): boolean {
  const s = String(text || "").toLowerCase();
  if (!s) return false;

  if (/[ëç]/.test(s)) return true;

  const strongSignals = [
    "tregt",
    "ekzekutuar",
    "ftes",
    "kërko",
    "regjistr",
    "llogari",
    "siguri",
    "dësht",
    "zgjidh",
    "mirëmbajt",
    "bazës",
    "të dhën",
    "ju lutemi",
    "nuk është",
  ];
  for (const w of strongSignals) {
    if (s.includes(w)) return true;
  }

  const stopwords = ["dhe", "të", "është", "për", "nuk", "ju", "lutemi", "tani"];
  const hits = stopwords.reduce((n, w) => (new RegExp(`\\b${w}\\b`, "i").test(s) ? n + 1 : n), 0);
  return hits >= 2;
}

function isSuspectTranslation(locale: string, translated: string): boolean {
  const base = baseLocale(locale);
  if (base === "sw") return looksSwedish(translated) || looksAlbanian(translated) || hasLatinDiacritics(translated);
  return false;
}

function targetLanguageLabel(locale: string): string {
  const base = baseLocale(locale);

  const fallback: Record<string, string> = {
    ar: "Arabic",
    bn: "Bengali",
    de: "German",
    es: "Spanish",
    fr: "French",
    hi: "Hindi",
    id: "Indonesian",
    ja: "Japanese",
    ko: "Korean",
    ms: "Malay",
    pt: "Portuguese",
    sw: "Swahili",
    th: "Thai",
    tl: "Tagalog",
    tr: "Turkish",
    zh: "Chinese",
  };

  try {
    const dn = new Intl.DisplayNames(["en"], { type: "language" });
    const name = dn.of(base);
    if (name) return `${name} (${locale})`;
  } catch {}

  const fb = fallback[base];
  return fb ? `${fb} (${locale})` : locale;
}

function cleanJson(content: string): string {
  const trimmed = String(content || "").trim();
  if (!trimmed) return "{}";
  // Strip ```json fences if present.
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

function encodePlaceholders(text: string) {
  const map: Record<string, string> = {};
  let idx = 0;
  const encoded = String(text || "").replace(PLACEHOLDER_RE, (token) => {
    const key = `__PH_${idx++}__`;
    map[key] = token;
    return key;
  });
  return { encoded, map };
}

function decodePlaceholders(text: string, map: Record<string, string> | undefined) {
  if (!map) return text;
  let out = text;
  for (const [k, v] of Object.entries(map)) {
    if (!k || !v) continue;
    out = out.replaceAll(k, v);
  }
  return out;
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function translateWithOpenAi(params: {
  locale: string;
  model: string;
  items: OpenAiTranslateItem[];
  strict?: boolean;
}): Promise<Record<string, string>> {
  const base = baseLocale(params.locale);
  const strict = params.strict === true;
  const maxItemsPerRequest = base === "sw" ? (strict ? 5 : 12) : 50;
  if (params.items.length > maxItemsPerRequest) {
    const merged: Record<string, string> = {};
    for (let i = 0; i < params.items.length; i += maxItemsPerRequest) {
      const chunk = params.items.slice(i, i + maxItemsPerRequest);
      const partial = await translateWithOpenAi({ ...params, items: chunk });
      Object.assign(merged, partial);
    }
    return merged;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  const model =
    strict && base === "sw" && params.model === "gpt-4o-mini"
      ? "gpt-4o"
      : params.model;

  const placeholderMapById = new Map<string, Record<string, string>>();
  const encodedItems = params.items.map((it) => {
    const { encoded, map } = encodePlaceholders(it.text);
    placeholderMapById.set(it.id, map);
    return { id: it.id, text: encoded };
  });

  const payload = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a translation engine for a trading dashboard UI. Return ONLY valid JSON. Translate all UI words even if short or ALL CAPS; do not leave English unless it is a currency pair symbol/ticker (e.g., EURUSD), a product name, or a placeholder. Translate trading terms like Buy, Sell, Order, Lots, Stop Loss, Take Profit, Market, Limit, Stop, Error, Validation, Journal, Risk Guardrail, Admin / Security, No Bots. Keep abbreviations like TP/SL but translate surrounding words. IMPORTANT: Always translate into the specified TARGET LANGUAGE; do not mix languages and do not guess based on locale codes. PLACEHOLDERS: input texts may contain placeholder markers and/or placeholder sentinels like __PH_0__. You MUST copy placeholder markers/sentinels exactly; do not remove them and do not translate inside them.",
      },
      {
        role: "user",
        content: [
          `TARGET LANGUAGE: ${targetLanguageLabel(params.locale)}`,
          `Target locale code: ${params.locale}`,
          base === "sw"
            ? [
                "IMPORTANT: Locale code `sw` means Swahili (Kiswahili). DO NOT output Swedish/Svenska (Swedish locale is `sv`).",
                "Swahili examples (follow this language): Save Settings -> Hifadhi Mipangilio; Trade Executed -> Biashara Imefanyika; Notification Preferences -> Mipendeleo ya Arifa.",
              ].join("\n")
            : null,
          "Translate the following items. Input is a JSON array of objects with {id, text}.",
          "If text contains placeholder sentinels like __PH_0__, keep them EXACTLY (same spelling/case) in the output.",
          "Return a JSON object whose keys are the same ids and values are the translated strings.",
          JSON.stringify(encodedItems),
        ].join("\n"),
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const safeDetail = sanitizeExternalErrorText(body, 320);
    throw new Error(
      safeDetail ? `OpenAI error (${res.status}): ${safeDetail}` : `OpenAI error (${res.status})`,
    );
  }

  const json = (await res.json()) as any;
  const content = String(json?.choices?.[0]?.message?.content || "");
  const cleaned = cleanJson(content);

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Some models may return extra leading text; try to salvage a JSON object substring.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } else {
      throw new Error("Failed to parse OpenAI JSON response");
    }
  }

  if (!parsed || typeof parsed !== "object") throw new Error("OpenAI returned non-object JSON");

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const raw = String(v);
    const withGlossary = applyGlossary(params.locale, raw);
    const decoded = decodePlaceholders(withGlossary, placeholderMapById.get(String(k)));
    out[String(k)] = decoded;
  }

  // Swahili is commonly mis-generated as Swedish when using the short locale code.
  // Retry suspicious outputs with a stricter prompt and (optionally) a stronger model.
  if (base === "sw" && !strict) {
    const bad = params.items.filter((it) => isSuspectTranslation(params.locale, out[it.id]));
    if (bad.length) {
      const retry = await translateWithOpenAi({ ...params, items: bad, strict: true });
      for (const it of bad) {
        const v = retry[it.id];
        if (typeof v === "string" && v.trim()) out[it.id] = v;
      }
    }
  }

  return out;
}

export function stableBatchKey(locale: string, items: Array<{ id: string; text: string }>): string {
  const payload = JSON.stringify([locale, items.map((i) => [i.id, i.text])]);
  return createHash("sha256").update(payload).digest("hex");
}
