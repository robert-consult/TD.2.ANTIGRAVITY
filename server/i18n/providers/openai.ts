import { createHash } from "node:crypto";

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
          "You are a translation engine for a trading dashboard UI. Return ONLY valid JSON. Preserve placeholders like {name}, {{name}}, %{name}, ${name}, and do not translate currency pair symbols (e.g., EURUSD).",
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
    out[String(k)] = String(v);
  }
  return out;
}

export function stableBatchKey(locale: string, items: Array<{ id: string; text: string }>): string {
  const payload = JSON.stringify([locale, items.map((i) => [i.id, i.text])]);
  return createHash("sha256").update(payload).digest("hex");
}

