import { createHash } from "node:crypto";
import { applyGlossary } from "../glossary";

type OpenAiTranslateItem = { id: string; text: string };

function cleanJson(content: string): string {
  const trimmed = String(content || "").trim();
  if (!trimmed) return "{}";
  // Strip ```json fences if present.
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function translateWithOpenAi(params: {
  locale: string;
  model: string;
  items: OpenAiTranslateItem[];
}): Promise<Record<string, string>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  const payload = {
    model: params.model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a translation engine for a trading dashboard UI. Return ONLY valid JSON. Preserve placeholders like {name}, {{name}}, %{name}, ${name}. Translate all UI words even if short or ALL CAPS; do not leave English unless it is a currency pair symbol/ticker (e.g., EURUSD), a product name, or a placeholder. Translate trading terms like Buy, Sell, Order, Lots, Stop Loss, Take Profit, Market, Limit, Stop, Error, Validation, Journal, Risk Guardrail, Admin / Security, No Bots. Keep abbreviations like TP/SL but translate surrounding words.",
      },
      {
        role: "user",
        content: [
          `Target locale: ${params.locale}`,
          "Translate the following items. Input is a JSON array of objects with {id, text}.",
          "Return a JSON object whose keys are the same ids and values are the translated strings.",
          JSON.stringify(params.items),
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
    throw new Error(`OpenAI error (${res.status}): ${body}`);
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
    out[String(k)] = applyGlossary(params.locale, raw);
  }
  return out;
}

export function stableBatchKey(locale: string, items: Array<{ id: string; text: string }>): string {
  const payload = JSON.stringify([locale, items.map((i) => [i.id, i.text])]);
  return createHash("sha256").update(payload).digest("hex");
}
