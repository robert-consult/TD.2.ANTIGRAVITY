import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { getActiveProviderSelection } from "../marketdata/providerManager";

export function registerMarketRoutes(app: Express) {
  function normalizeRequestedSymbols(raw: unknown): string[] {
    return String(raw ?? "")
      .split(",")
      .map((value) => value.trim().replace("/", "").toUpperCase())
      .filter(Boolean);
  }

  app.get("/api/market/quotes", async (req: Request, res: Response) => {
    try {
      const requestedSymbols = normalizeRequestedSymbols(req.query.pairs ?? req.query.symbols);
      if (!requestedSymbols.length) {
        return res.status(400).json({ ok: false, error: "pairs or symbols query parameter is required" });
      }

      const selection = await getActiveProviderSelection();
      if (!selection) {
        return res.status(503).json({ ok: false, error: "No active market-data provider is available" });
      }

      const providerSymbols = requestedSymbols
        .map((canonicalSymbol) => {
          const providerSymbol =
            typeof selection.provider.mapSymbol === "function"
              ? selection.provider.mapSymbol(canonicalSymbol)
              : canonicalSymbol;
          return providerSymbol ? { canonicalSymbol, providerSymbol } : null;
        })
        .filter((value): value is { canonicalSymbol: string; providerSymbol: string } => value !== null);

      if (!providerSymbols.length) {
        return res.status(400).json({ ok: false, error: "None of the requested symbols are supported by the active provider" });
      }

      const result = await selection.provider.fetchQuotes({ symbols: providerSymbols });
      return res.json({
        ok: true,
        providerKey: selection.providerKey,
        driver: selection.provider.driver,
        rows: result.quotes.map((quote) => ({
          symbol: quote.canonicalSymbol,
          bid: quote.bid,
          ask: quote.ask,
          price: quote.price,
          timestamp: quote.tsMs,
        })),
        ...(String(req.query.includeRaw ?? "").trim() === "1" ? { raw: result.raw ?? null } : {}),
      });
    } catch (error: any) {
      console.error("Error fetching market data quotes:", error);
      return res.status(500).json({ ok: false, error: String(error?.message ?? error) });
    }
  });

  app.get("/api/market/symbols", async (req: Request, res: Response) => {
    try {
      const selection = await getActiveProviderSelection();
      const source = String(req.query.source ?? "").trim().toLowerCase();
      const category = String(req.query.category ?? "forex").trim().toLowerCase();
      const limitRaw = Number(req.query.limit ?? 100);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 100;

      if (source === "provider" && selection?.provider.listReference) {
        const rows = await selection.provider.listReference({ category, limit });
        return res.json({
          ok: true,
          source: "provider",
          providerKey: selection.providerKey,
          category,
          rows,
        });
      }

      const rows = await storage.getSymbolConfigs();
      return res.json({
        ok: true,
        source: "db",
        providerKey: selection?.providerKey ?? null,
        rows,
      });
    } catch (error: any) {
      console.error("Error fetching market symbols:", error);
      return res.status(500).json({ ok: false, error: String(error?.message ?? error) });
    }
  });
}
