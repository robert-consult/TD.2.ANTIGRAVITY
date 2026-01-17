import fs from "node:fs/promises";
import path from "node:path";
import { dbClient } from "@db";
import { applyGlossary } from "../server/i18n/glossary";
import { refreshI18nConfig } from "../server/i18n/config";

const TARGET_TEXTS = new Set([
  "Auto-Fix (±",
  "Error",
  "JOURNAL",
  "NO BOTs",
  "Order",
  "RISK GUARDRAIL",
  "Stop Loss",
  "VALIDATION",
  "lots",
]);

async function resolveManifestPath(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "dist", "public", "i18n-manifest.json"),
    path.resolve(process.cwd(), "client", "i18n-manifest.json"),
  ];
  const available: Array<{ path: string; mtimeMs: number }> = [];
  for (const candidate of candidates) {
    try {
      const st = await fs.stat(candidate);
      available.push({ path: candidate, mtimeMs: st.mtimeMs });
    } catch {
      // try next
    }
  }
  if (!available.length) {
    throw new Error("i18n-manifest.json not found (run npm run build first)");
  }
  available.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return available[0].path;
}

async function main() {
  const manifestPath = await resolveManifestPath();
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    entries: Array<{ id: string; defaultText: string }>;
  };

  const stringIds = Array.from(
    new Set(
      manifest.entries
        .filter((e) => TARGET_TEXTS.has(String(e.defaultText)))
        .map((e) => String(e.id))
    )
  );

  if (!stringIds.length) {
    console.log("[i18n-glossary] No matching entries found in manifest.");
    return;
  }

  const cfg = await refreshI18nConfig();
  const locales = (cfg.supportedLocales || []).filter(
    (l) => l.toLowerCase() !== cfg.defaultLocale.toLowerCase()
  );

  const now = Math.floor(Date.now() / 1000);
  let updated = 0;

  try {
    for (const locale of locales) {
      const res = await dbClient.query(
        `
        SELECT string_id, translated_text
        FROM i18n_translations
        WHERE locale = $1 AND string_id = ANY($2)
        `,
        [locale, stringIds]
      );

      for (const row of res.rows) {
        const before = String(row.translated_text || "");
        const after = applyGlossary(locale, before);
        if (after !== before) {
          await dbClient.query(
            `
            UPDATE i18n_translations
            SET translated_text = $1, updated_at = $2
            WHERE locale = $3 AND string_id = $4
            `,
            [after, now, locale, row.string_id]
          );
          updated += 1;
        }
      }
    }

    console.log(`[i18n-glossary] Updated ${updated} translation rows.`);
  } finally {
    await dbClient.end();
  }
}

main().catch((err) => {
  console.error("[i18n-glossary] failed:", err);
  process.exit(1);
});
