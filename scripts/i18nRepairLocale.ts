import "dotenv/config";
import { Client } from "pg";

type RepairMode = "suspect" | "all";

const LOCALE = String(process.env.REPAIR_LOCALE ?? "sw").trim() || "sw";
const MODE = (String(process.env.REPAIR_MODE ?? "").trim().toLowerCase() as RepairMode) || (LOCALE.toLowerCase() === "sw" ? "suspect" : "all");
const DRY_RUN = process.env.REPAIR_DRY_RUN === "1";
const DELETE_TRANSLATIONS = process.env.REPAIR_DELETE_TRANSLATIONS === "1";

function log(message: string) {
  console.log(`[i18n-repair] ${message}`);
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

  const hits = [
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
    "eller",
  ].reduce((n, w) => (new RegExp(`\\b${w}\\b`, "i").test(s) ? n + 1 : n), 0);

  return hits >= 2;
}

function isSuspectTranslation(locale: string, text: string): boolean {
  const base = String(locale || "").trim().toLowerCase().split("-")[0] || "en";
  if (base === "sw") return looksSwedish(text) || looksAlbanian(text) || hasLatinDiacritics(text);
  return false;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  log(`locale=${LOCALE} mode=${MODE} dryRun=${DRY_RUN ? "yes" : "no"} deleteTranslations=${DELETE_TRANSLATIONS ? "yes" : "no"}`);

  const ids: string[] = [];

  if (MODE === "all") {
    const res = await client.query<{ string_id: string }>(
      "SELECT string_id FROM i18n_translation_jobs WHERE locale = $1",
      [LOCALE],
    );
    for (const r of res.rows) ids.push(String((r as any).string_id));
  } else {
    const res = await client.query<{ string_id: string; translated_text: string }>(
      "SELECT string_id, translated_text FROM i18n_translations WHERE locale = $1",
      [LOCALE],
    );
    for (const r of res.rows) {
      const stringId = String((r as any).string_id);
      const text = String((r as any).translated_text ?? "");
      if (isSuspectTranslation(LOCALE, text)) ids.push(stringId);
    }
  }

  const uniqueIds = Array.from(new Set(ids));
  log(`targets=${uniqueIds.length}`);

  if (!uniqueIds.length) {
    await client.end();
    log("Nothing to repair.");
    return;
  }

  if (DRY_RUN) {
    const sample = uniqueIds.slice(0, 10);
    log(`sample ids: ${sample.join(", ")}`);
    await client.end();
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  const upd = await client.query(
    `
    UPDATE i18n_translation_jobs
    SET status = 'PENDING',
        attempt_count = 0,
        last_error = NULL,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = $1
    WHERE locale = $2
      AND string_id = ANY($3::text[])
    `,
    [now, LOCALE, uniqueIds],
  );

  log(`requeued=${upd.rowCount ?? 0}`);

  if (DELETE_TRANSLATIONS) {
    const del = await client.query(
      `
      DELETE FROM i18n_translations
      WHERE locale = $1
        AND string_id = ANY($2::text[])
      `,
      [LOCALE, uniqueIds],
    );
    log(`deletedTranslations=${del.rowCount ?? 0}`);
  }

  await client.end();
  log("Done. Run `tsx scripts/i18nRunWorker.ts` (or POST /api/admin/i18n/run-worker repeatedly) to regenerate.");
}

main().catch((err) => {
  log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
