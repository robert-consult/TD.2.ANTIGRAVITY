// server/routes/instruments.ts
import { Router } from "express";
import { dbClient } from "@db";
import { instruments, Instrument } from "../../data/instruments";
import {
  categoryToLegacyAssetClass,
  normalizeInstrumentCategory,
} from "@shared/instruments/categories";

const router = Router();

/**
 *  GET /api/instruments?search=aud
 *  Returns max 25 case-insensitive matches.
 */
router.get("/", async (req, res) => {
  const q = String((req.query.search as string | undefined) ?? "").trim();
  const like = q ? `%${q}%` : "%";

  try {
    const rows = await dbClient.query(
      `
        SELECT
          id,
          symbol,
          name,
          category,
          base_currency AS "baseCurrency",
          quote_currency AS "quoteCurrency"
        FROM symbol_configs
        WHERE symbol ILIKE $1 OR name ILIKE $1
        ORDER BY symbol ASC
        LIMIT 25
      `,
      [like],
    );

    const dbResults: Instrument[] = (rows.rows as any[]).map((r) => ({
      category: normalizeInstrumentCategory(r.category, "unknown"),
      symbol: String(r.symbol),
      displayName: String(r.name ?? r.symbol),
      base: String(r.baseCurrency ?? ""),
      quote: String(r.quoteCurrency ?? ""),
      assetClass: categoryToLegacyAssetClass(r.category, { symbol: r.symbol }),
    }));

    const seen = new Set(dbResults.map((r) => r.symbol.toUpperCase()));
    const qUpper = q.toUpperCase();
    const fallback = instruments
      .filter((i) =>
        qUpper
          ? i.symbol.toUpperCase().includes(qUpper) || i.displayName.toUpperCase().includes(qUpper)
          : true,
      )
      .filter((i) => !seen.has(i.symbol.toUpperCase()));

    res.json([...dbResults, ...fallback].slice(0, 25));
  } catch (e) {
    // Fall back to static list if DB is unavailable (e.g., early boot).
    const qUpper = q.toUpperCase();
    const matches: Instrument[] = qUpper
      ? instruments.filter((i) => i.symbol.toUpperCase().includes(qUpper) || i.displayName.toUpperCase().includes(qUpper))
      : instruments;
    res.json(matches.slice(0, 25));
  }
});

export default router;
