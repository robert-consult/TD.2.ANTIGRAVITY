import { Router } from "express";
import { db, dbClient } from "@db";
import { instrumentReference, marketDataProviders, pipCategoryDefaults, symbolConfigs, systemConfig } from "@shared/schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middleware/requireAdmin";
import { MarketDataProviderConfigSchema } from "@shared/marketDataProviders";
import { activateProvider, getProviderByKey } from "../marketdata/providerManager";
import { buildProviderFromConfig } from "../marketdata/providerRegistry";
import { publishLiveEvent } from "../services/liveBus";
import { resolveSecretRef } from "../marketdata/secret";
import { loadProviderConfigsFromDir, syncProviderConfigsFromDirToDb, type ProviderConfigFilesSyncMode } from "../marketdata/providerConfigFiles";

export const adminMarketDataRouter = Router();
adminMarketDataRouter.use(requireAdmin);

const PROVIDER_TEST_WINDOW_MS = 30_000;
const PROVIDER_TEST_MAX_CALLS = 5;
const providerTestCallsByUserId = new Map<number, number[]>();

const PROVIDER_RELOAD_WINDOW_MS = 30_000;
const PROVIDER_RELOAD_MAX_CALLS = 5;
const providerReloadCallsByUserId = new Map<number, number[]>();

function allowProviderTest(userId: number): boolean {
  const now = Date.now();
  const prev = providerTestCallsByUserId.get(userId) ?? [];
  const kept = prev.filter((t) => now - t < PROVIDER_TEST_WINDOW_MS);
  if (kept.length >= PROVIDER_TEST_MAX_CALLS) {
    providerTestCallsByUserId.set(userId, kept);
    return false;
  }
  kept.push(now);
  providerTestCallsByUserId.set(userId, kept);
  return true;
}

function allowProviderReload(userId: number): boolean {
  const now = Date.now();
  const prev = providerReloadCallsByUserId.get(userId) ?? [];
  const kept = prev.filter((t) => now - t < PROVIDER_RELOAD_WINDOW_MS);
  if (kept.length >= PROVIDER_RELOAD_MAX_CALLS) {
    providerReloadCallsByUserId.set(userId, kept);
    return false;
  }
  kept.push(now);
  providerReloadCallsByUserId.set(userId, kept);
  return true;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function normalizeProviderKey(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v)) return null;
  return v;
}

function parseCsv(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeJsonParseObject(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as any;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isEnvSecretRef(ref: unknown): boolean {
  const v = String(ref ?? "").trim();
  return v.toLowerCase().startsWith("env:");
}

function redactProviderConfigSecrets(config: any): any {
  if (!config || typeof config !== "object") return config;
  const out = { ...config };
  const redact = (value: unknown) => {
    const v = String(value ?? "").trim();
    if (!v) return value;
    return v.toLowerCase().startsWith("env:") ? value : "redacted";
  };

  if (out.driver === "twelvedata" && out.apiKey != null) out.apiKey = redact(out.apiKey);
  if (out.driver === "oneforge" && out.apiKey != null) out.apiKey = redact(out.apiKey);
  if (out.driver === "generic_rest_v1" && out.apiKey != null) out.apiKey = redact(out.apiKey);
  return out;
}

function normalizeCanonicalSymbol(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return s.replace("/", "").trim().toUpperCase();
}

function canonicalizeReferenceSymbol(category: string, item: any): { canonical: string; providerSymbol: string } | null {
  const providerSymbolRaw = String(item?.symbol ?? item?.provider_symbol ?? "").trim();
  if (!providerSymbolRaw) return null;

  const symbolRaw = String(item?.symbol ?? "").trim();
  const exchangeRaw = String(item?.exchange ?? item?.mic_code ?? "").trim();

  const cat = String(category || "").toLowerCase();

  // Stocks/ETFs/funds may collide globally; include exchange when available.
  if (cat === "stocks" || cat === "etf" || cat === "funds" || cat === "mutual_funds" || cat === "bonds") {
    const base = symbolRaw || providerSymbolRaw;
    const canonical = exchangeRaw ? `${base}:${exchangeRaw}` : base;
    const normalized = normalizeCanonicalSymbol(canonical);
    if (!normalized) return null;
    return { canonical: normalized, providerSymbol: providerSymbolRaw };
  }

  // Default: remove slashes and normalize.
  const canonical = normalizeCanonicalSymbol(providerSymbolRaw);
  if (!canonical) return null;
  return { canonical, providerSymbol: providerSymbolRaw };
}

async function loadDefaultProviderSymbolMappers(): Promise<Array<{ providerKey: string; mapSymbol: (canonicalSymbol: string) => string | null }>> {
  const rows = await db
    .select()
    .from(marketDataProviders)
    .where(and(isNull(marketDataProviders.deletedAt), eq(marketDataProviders.isEnabled, true)))
    .orderBy(asc(marketDataProviders.providerKey));

  const mappers: Array<{ providerKey: string; mapSymbol: (canonicalSymbol: string) => string | null }> = [];
  for (const row of rows as any[]) {
    try {
      const cfgRaw = safeJsonParseObject(row.configJson);
      const cfg = MarketDataProviderConfigSchema.parse({ ...(cfgRaw || {}), driver: cfgRaw?.driver ?? row.driver });
      const provider = buildProviderFromConfig({ providerKey: row.providerKey, displayName: row.displayName, cfg });
      const mapSymbol =
        typeof (provider as any).mapSymbol === "function"
          ? (provider as any).mapSymbol.bind(provider)
          : (canonicalSymbol: string) => normalizeCanonicalSymbol(canonicalSymbol);
      mappers.push({ providerKey: String(row.providerKey), mapSymbol });
    } catch {
      // skip invalid provider configs; do not block instrument enablement
    }
  }

  return mappers;
}

// ===== Providers =====

adminMarketDataRouter.get("/providers", async (_req, res) => {
  try {
    const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    const activeKey = cfg?.marketDataActiveProviderKey ? String(cfg.marketDataActiveProviderKey) : null;
    const fallbackKeys = parseCsv(cfg?.marketDataFallbackProviderKeysCsv);

    const rows = await db
      .select()
      .from(marketDataProviders)
      .where(and(isNull(marketDataProviders.deletedAt)))
      .orderBy(asc(marketDataProviders.providerKey));

    const computeSecretStatus = (row: any): { configUsable: boolean; missingSecrets: string[] } => {
      try {
        const cfgRaw = safeJsonParseObject(row.configJson);
        const parsed = MarketDataProviderConfigSchema.parse({ ...(cfgRaw || {}), driver: cfgRaw?.driver ?? row.driver });

        const missingSecrets: string[] = [];
        const noteMissing = (ref: string | undefined | null) => {
          if (!ref) return;
          const raw = String(ref).trim();
          if (!raw.toLowerCase().startsWith("env:")) return;
          const key = raw.slice(4).trim();
          if (!key) return;
          if (!process.env[key]) missingSecrets.push(key);
        };

        let configUsable = true;
        if (parsed.driver === "twelvedata") {
          configUsable = Boolean(resolveSecretRef(parsed.apiKey));
          if (!configUsable) noteMissing(parsed.apiKey);
        } else if (parsed.driver === "oneforge") {
          configUsable = Boolean(resolveSecretRef(parsed.apiKey));
          if (!configUsable) noteMissing(parsed.apiKey);
        } else if (parsed.driver === "generic_rest_v1") {
          if (parsed.apiKey) {
            configUsable = Boolean(resolveSecretRef(parsed.apiKey));
            if (!configUsable) noteMissing(parsed.apiKey);
          }
        }

        return { configUsable, missingSecrets: [...new Set(missingSecrets)].sort() };
      } catch {
        return { configUsable: false, missingSecrets: [] };
      }
    };

    res.json({
      ok: true,
      activeKey,
      fallbackKeys,
      rows: rows.map((r: any) => {
        const secretStatus = computeSecretStatus(r);
        return { ...r, isActive: activeKey ? r.providerKey === activeKey : false, ...secretStatus };
      }),
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.get("/providers/:providerKey/export", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.params.providerKey);
    if (!providerKey) return res.status(400).json({ ok: false, error: "Invalid providerKey" });

    const row = await db.query.marketDataProviders.findFirst({
      where: and(eq(marketDataProviders.providerKey, providerKey), isNull(marketDataProviders.deletedAt)),
    });
    if (!row) return res.status(404).json({ ok: false, error: "Provider not found" });

    const cfgRaw = safeJsonParseObject((row as any).configJson);
    const config = redactProviderConfigSecrets({ ...(cfgRaw || {}) });
    if (!config.driver) config.driver = row.driver;

    const payload = {
      providerKey: row.providerKey,
      displayName: row.displayName,
      driver: row.driver,
      config,
      exportedAt: new Date().toISOString(),
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="provider-${providerKey}.json"`);
    res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.get("/providers/files", async (_req, res) => {
  try {
    const loaded = await loadProviderConfigsFromDir({ strictDir: true });
    res.json({
      ok: loaded.errors.length === 0,
      dir: String(process.env.MARKET_DATA_PROVIDER_CONFIG_DIR ?? "config/marketdata/providers"),
      providers: loaded.providers.map((p) => ({
        providerKey: p.providerKey,
        displayName: p.displayName,
        driver: p.driver,
        isEnabled: p.isEnabled,
        config: redactProviderConfigSecrets(p.config),
        sourceFiles: p.sourceFiles.map((f) => String(f).split(/[\\/]/g).slice(-1)[0]),
      })),
      errors: loaded.errors.map((e) => ({
        file: String(e.file).split(/[\\/]/g).slice(-1)[0],
        error: e.error,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.post("/providers/reload-files", async (req, res) => {
  try {
    const userIdRaw = Number((req.session as any)?.userId);
    if (Number.isFinite(userIdRaw) && userIdRaw > 0 && !allowProviderReload(userIdRaw)) {
      return res.status(429).json({
        ok: false,
        error: `Rate limited: max ${PROVIDER_RELOAD_MAX_CALLS} reloads per ${Math.round(PROVIDER_RELOAD_WINDOW_MS / 1000)}s`,
      });
    }

    const modeRaw = String(req.body?.mode ?? "").trim();
    const mode: ProviderConfigFilesSyncMode = modeRaw === "upsert" ? "upsert" : "create_missing";

    const synced = await syncProviderConfigsFromDirToDb({ mode, strictDir: true });
    const changed = synced.createdKeys.length + synced.updatedKeys.length;

    if (changed > 0) {
      try {
        publishLiveEvent({
          type: "market-data:providers-updated",
          payload: { action: "reloaded-files", mode, created: synced.createdKeys.length, updated: synced.updatedKeys.length, at: Date.now() },
        });
      } catch {
        // ignore
      }
    }

    res.json({
      ok: synced.errors.length === 0,
      ...synced,
      dir: String(process.env.MARKET_DATA_PROVIDER_CONFIG_DIR ?? "config/marketdata/providers"),
    });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.get("/providers/export-bundle", async (_req, res) => {
  try {
    const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    const activeKey = cfg?.marketDataActiveProviderKey ? String(cfg.marketDataActiveProviderKey) : null;
    const fallbackKeys = parseCsv(cfg?.marketDataFallbackProviderKeysCsv);

    const rows = await db
      .select()
      .from(marketDataProviders)
      .where(and(isNull(marketDataProviders.deletedAt)))
      .orderBy(asc(marketDataProviders.providerKey));

    const providers = rows.map((r: any) => {
      const cfgRaw = safeJsonParseObject(r.configJson);
      const config = redactProviderConfigSecrets({ ...(cfgRaw || {}) });
      if (!config.driver) config.driver = r.driver;
      return {
        providerKey: r.providerKey,
        displayName: r.displayName,
        driver: r.driver,
        isEnabled: Boolean(r.isEnabled),
        config,
      };
    });

    const payload = {
      exportedAt: new Date().toISOString(),
      selection: { activeKey, fallbackKeys },
      providers,
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="market-data-providers.bundle.json"`);
    res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.post("/providers", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.body?.providerKey);
    const displayName = String(req.body?.displayName ?? "").trim();
    const driver = String(req.body?.driver ?? "").trim();
    const configObj = req.body?.config ?? safeJsonParseObject(req.body?.configJson);

    if (!providerKey) return res.status(400).json({ ok: false, error: "Invalid providerKey" });
    if (!displayName) return res.status(400).json({ ok: false, error: "displayName required" });
    if (!driver) return res.status(400).json({ ok: false, error: "driver required" });

    const config = { ...(configObj || {}) };
    if (!config.driver) config.driver = driver;
    if (config.driver !== driver) {
      return res.status(400).json({ ok: false, error: "config.driver must match driver" });
    }

    const parsed = MarketDataProviderConfigSchema.parse(config);

    // Security: do not store raw secrets in DB. Require env: refs for apiKey fields.
    if ((parsed as any).apiKey && !isEnvSecretRef((parsed as any).apiKey)) {
      return res.status(400).json({
        ok: false,
        error: "apiKey must be provided as an env reference like \"env:TWELVE_DATA_API_KEY\"",
      });
    }

    const now = nowSec();
    const [row] = await db
      .insert(marketDataProviders)
      .values({
        providerKey,
        displayName,
        driver,
        configJson: JSON.stringify(parsed),
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as any)
      .returning();

    try {
      publishLiveEvent({ type: "market-data:providers-updated", payload: { action: "created", providerKey, at: Date.now() } });
    } catch {
      // ignore
    }

    res.json({ ok: true, row });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.put("/providers/:providerKey", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.params.providerKey);
    if (!providerKey) return res.status(400).json({ ok: false, error: "Invalid providerKey" });

    const existing = await db.query.marketDataProviders.findFirst({
      where: and(eq(marketDataProviders.providerKey, providerKey), isNull(marketDataProviders.deletedAt)),
    });
    if (!existing) return res.status(404).json({ ok: false, error: "Provider not found" });

    const patch: any = {};
    if (typeof req.body?.displayName === "string" && req.body.displayName.trim()) patch.displayName = req.body.displayName.trim();
    if (typeof req.body?.isEnabled === "boolean") patch.isEnabled = req.body.isEnabled;

    const driver = String(req.body?.driver ?? existing.driver ?? "").trim();
    const configObj = req.body?.config ?? safeJsonParseObject(req.body?.configJson ?? existing.configJson);
    const config = { ...(configObj || {}) };
    if (!config.driver) config.driver = driver;
    if (config.driver !== driver) return res.status(400).json({ ok: false, error: "config.driver must match driver" });

    const parsed = MarketDataProviderConfigSchema.parse(config);
    if ((parsed as any).apiKey && !isEnvSecretRef((parsed as any).apiKey)) {
      return res.status(400).json({ ok: false, error: "apiKey must be an env: reference" });
    }

    patch.driver = driver;
    patch.configJson = JSON.stringify(parsed);
    patch.updatedAt = nowSec();

    const [updated] = await db
      .update(marketDataProviders)
      .set(patch)
      .where(eq(marketDataProviders.providerKey, providerKey))
      .returning();

    try {
      publishLiveEvent({
        type: "market-data:providers-updated",
        payload: { action: "updated", providerKey, at: Date.now() },
      });
    } catch {
      // ignore
    }

    res.json({ ok: true, row: updated });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.delete("/providers/:providerKey", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.params.providerKey);
    if (!providerKey) return res.status(400).json({ ok: false, error: "Invalid providerKey" });

    const protectedKeys = new Set(["twelvedata", "1forge"]);
    if (protectedKeys.has(providerKey)) {
      return res.status(400).json({ ok: false, error: "Built-in providers cannot be deleted" });
    }

    const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    if (cfg?.marketDataActiveProviderKey && String(cfg.marketDataActiveProviderKey) === providerKey) {
      return res.status(400).json({ ok: false, error: "Cannot delete the active provider" });
    }

    const now = nowSec();
    await db
      .update(marketDataProviders)
      .set({ isEnabled: false, deletedAt: now, updatedAt: now })
      .where(eq(marketDataProviders.providerKey, providerKey));

    try {
      publishLiveEvent({
        type: "market-data:providers-updated",
        payload: { action: "deleted", providerKey, at: Date.now() },
      });
    } catch {
      // ignore
    }

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.post("/providers/:providerKey/activate", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.params.providerKey);
    if (!providerKey) return res.status(400).json({ ok: false, error: "Invalid providerKey" });

    const adminEmail = String((req.session as any)?.email || "").trim() || null;
    await activateProvider(providerKey, { adminEmail });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.post("/providers/:providerKey/test", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.params.providerKey);
    if (!providerKey) return res.status(400).json({ ok: false, error: "Invalid providerKey" });

    const userIdRaw = Number((req.session as any)?.userId);
    if (Number.isFinite(userIdRaw) && userIdRaw > 0 && !allowProviderTest(userIdRaw)) {
      return res.status(429).json({
        ok: false,
        error: `Rate limited: max ${PROVIDER_TEST_MAX_CALLS} tests per ${Math.round(PROVIDER_TEST_WINDOW_MS / 1000)}s`,
      });
    }

    const inst = await getProviderByKey(providerKey);
    if (!inst) return res.status(404).json({ ok: false, error: "Provider not found" });

    const symbolsRaw = Array.isArray(req.body?.symbols) ? req.body.symbols : ["EURUSD"];
    const canonicalSymbols = symbolsRaw.map(normalizeCanonicalSymbol).filter(Boolean).slice(0, 20);
    if (!canonicalSymbols.length) return res.status(400).json({ ok: false, error: "No symbols provided" });

    const mapped = canonicalSymbols
      .map((canonical: string) => {
        const providerSymbol =
          typeof (inst.provider as any).mapSymbol === "function"
            ? (inst.provider as any).mapSymbol(canonical)
            : canonical;
        if (!providerSymbol) return null;
        return { canonicalSymbol: canonical, providerSymbol: String(providerSymbol) };
      })
      .filter(Boolean) as any[];

    const result = await inst.provider.fetchQuotes({ symbols: mapped });

    const rawSummary = (() => {
      const raw = (result as any)?.raw;
      if (raw == null) return null;
      if (Array.isArray(raw)) return { type: "array", length: raw.length };
      if (typeof raw === "string") return { type: "string", length: raw.length, sample: raw.slice(0, 200) };
      if (typeof raw === "object") return { type: "object", keys: Object.keys(raw as any).slice(0, 30) };
      return { type: typeof raw, sample: String(raw).slice(0, 200) };
    })();

    const quoteCount = result.quotes.length;
    const hints =
      quoteCount > 0
        ? []
        : [
            "No quotes returned. Verify symbol mapping (providerSymbol) and the provider response schema.",
            inst.provider.driver === "generic_rest_v1"
              ? "Generic driver: double-check responseMode/wrapperKey and fields (symbol/bid/ask/price/timestamp)."
              : "Try testing a single known-good symbol (e.g., EURUSD) and confirm provider account/quota status.",
          ];

    res.json({
      ok: true,
      providerKey: inst.providerKey,
      driver: inst.provider.driver,
      quoteCount,
      sample: result.quotes.slice(0, 5),
      mappedSymbols: mapped.slice(0, 10),
      rawSummary,
      hints,
    });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// ===== Instrument Reference =====

adminMarketDataRouter.post("/instruments/reference/import", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.body?.providerKey);
    const categoryDefault = String(req.body?.category ?? "").trim().toLowerCase();
    const rowsRaw = Array.isArray(req.body?.rows) ? req.body.rows : [];

    let keyToUse = providerKey;
    if (!keyToUse) {
      const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
      keyToUse = cfg?.marketDataActiveProviderKey ? String(cfg.marketDataActiveProviderKey) : null;
    }
    if (!keyToUse) return res.status(400).json({ ok: false, error: "No providerKey (and no active provider configured)" });

    if (!rowsRaw.length) return res.status(400).json({ ok: false, error: "rows required" });
    if (rowsRaw.length > 50_000) return res.status(400).json({ ok: false, error: "Too many rows (max 50000)" });

    const providerMappers = await loadDefaultProviderSymbolMappers();
    const mapperForKey = providerMappers.find((m) => m.providerKey === keyToUse) ?? null;

    const now = nowSec();

    const isStockLike = (cat: string) => {
      const c = String(cat || "").toLowerCase();
      return c === "stocks" || c === "etf" || c === "funds" || c === "mutual_funds" || c === "bonds";
    };

    const normalized = rowsRaw
      .map((item: any) => {
        const category = String(item?.category ?? categoryDefault ?? "").trim().toLowerCase();
        if (!category) return null;

        const symbolRaw = String(item?.canonicalSymbol ?? item?.canonical_symbol ?? item?.symbol ?? item?.ticker ?? item?.pair ?? "").trim();
        const providerSymbolRaw = String(item?.providerSymbol ?? item?.provider_symbol ?? item?.provider_symbol_raw ?? "").trim();
        const exchangeRaw = String(item?.exchange ?? item?.mic_code ?? item?.micCode ?? "").trim();

        // Allow raw symbols like "AAPL:NASDAQ" in input.
        const baseSymbol = symbolRaw.includes(":") ? symbolRaw.split(":")[0] : symbolRaw;

        const canonicalCandidate = isStockLike(category)
          ? exchangeRaw
            ? `${baseSymbol}:${exchangeRaw}`
            : symbolRaw
          : (symbolRaw || providerSymbolRaw);

        const canonicalSymbol = normalizeCanonicalSymbol(canonicalCandidate);
        if (!canonicalSymbol) return null;

        let providerSymbol = providerSymbolRaw;
        if (!providerSymbol) {
          if (isStockLike(category) && baseSymbol) providerSymbol = baseSymbol;
          else if (mapperForKey) providerSymbol = mapperForKey.mapSymbol(canonicalSymbol) ?? canonicalSymbol;
          else providerSymbol = canonicalSymbol;
        }
        if (!providerSymbol) return null;

        return {
          providerKey: keyToUse,
          category,
          canonicalSymbol,
          providerSymbol,
          name: item?.name != null ? String(item.name) : null,
          currency: item?.currency != null ? String(item.currency) : null,
          exchange: exchangeRaw || (item?.exchange_code != null ? String(item.exchange_code) : null),
          country: item?.country != null ? String(item.country) : null,
          type: item?.type != null ? String(item.type) : null,
          currencyBase: item?.currencyBase != null ? String(item.currencyBase) : item?.currency_base != null ? String(item.currency_base) : null,
          currencyQuote: item?.currencyQuote != null ? String(item.currencyQuote) : item?.currency_quote != null ? String(item.currency_quote) : null,
          region: item?.region != null ? String(item.region) : null,
          metaJson: JSON.stringify(item ?? {}),
          lastRefreshedAt: now,
        };
      })
      .filter(Boolean) as any[];

    if (!normalized.length) return res.status(400).json({ ok: false, error: "No valid rows to import" });

    const batchSize = 500;
    for (let i = 0; i < normalized.length; i += batchSize) {
      const batch = normalized.slice(i, i + batchSize);
      await db
        .insert(instrumentReference)
        .values(batch)
        .onConflictDoUpdate({
          target: [instrumentReference.providerKey, instrumentReference.canonicalSymbol, instrumentReference.providerSymbol],
          set: {
            name: sql`excluded.name`,
            currency: sql`excluded.currency`,
            exchange: sql`excluded.exchange`,
            country: sql`excluded.country`,
            type: sql`excluded.type`,
            currencyBase: sql`excluded.currency_base`,
            currencyQuote: sql`excluded.currency_quote`,
            region: sql`excluded.region`,
            metaJson: sql`excluded.meta_json`,
            lastRefreshedAt: now,
          } as any,
        });
    }

    res.json({ ok: true, providerKey: keyToUse, imported: normalized.length });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.post("/instruments/reference/refresh", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.body?.providerKey);
    const category = String(req.body?.category ?? "").trim().toLowerCase();
    const filter = req.body?.filter && typeof req.body.filter === "object" ? req.body.filter : undefined;
    const limit = req.body?.limit != null ? Number(req.body.limit) : undefined;

    if (!category) return res.status(400).json({ ok: false, error: "category required" });

    let keyToUse = providerKey;
    if (!keyToUse) {
      const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
      keyToUse = cfg?.marketDataActiveProviderKey ? String(cfg.marketDataActiveProviderKey) : null;
    }
    if (!keyToUse) return res.status(400).json({ ok: false, error: "No providerKey (and no active provider configured)" });

    const inst = await getProviderByKey(keyToUse);
    if (!inst) return res.status(404).json({ ok: false, error: "Provider not found" });
    if (typeof (inst.provider as any).listReference !== "function") {
      return res.status(400).json({ ok: false, error: "Provider does not support reference data" });
    }

    const rows = await (inst.provider as any).listReference({ category, filter, limit });
    const now = nowSec();

    const normalized = rows
      .map((item: any) => {
        const sym = canonicalizeReferenceSymbol(category, item);
        if (!sym) return null;
        return {
          providerKey: inst.providerKey,
          category,
          canonicalSymbol: sym.canonical,
          providerSymbol: sym.providerSymbol,
          name: item?.name != null ? String(item.name) : null,
          currency: item?.currency != null ? String(item.currency) : null,
          exchange: item?.exchange != null ? String(item.exchange) : null,
          country: item?.country != null ? String(item.country) : null,
          type: item?.type != null ? String(item.type) : null,
          currencyBase: item?.currency_base != null ? String(item.currency_base) : item?.currencyBase != null ? String(item.currencyBase) : null,
          currencyQuote: item?.currency_quote != null ? String(item.currency_quote) : item?.currencyQuote != null ? String(item.currencyQuote) : null,
          region: item?.region != null ? String(item.region) : null,
          metaJson: JSON.stringify(item ?? {}),
          lastRefreshedAt: now,
        };
      })
      .filter(Boolean) as any[];

    const batchSize = 500;
    for (let i = 0; i < normalized.length; i += batchSize) {
      const batch = normalized.slice(i, i + batchSize);
      await db
        .insert(instrumentReference)
        .values(batch)
        .onConflictDoUpdate({
          target: [instrumentReference.providerKey, instrumentReference.canonicalSymbol, instrumentReference.providerSymbol],
          set: {
            name: sql`excluded.name`,
            currency: sql`excluded.currency`,
            exchange: sql`excluded.exchange`,
            country: sql`excluded.country`,
            type: sql`excluded.type`,
            currencyBase: sql`excluded.currency_base`,
            currencyQuote: sql`excluded.currency_quote`,
            region: sql`excluded.region`,
            metaJson: sql`excluded.meta_json`,
            lastRefreshedAt: now,
          } as any,
        });
    }

    res.json({ ok: true, providerKey: inst.providerKey, category, ingested: normalized.length });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.get("/instruments/reference/search", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.query.providerKey);
    const category = String(req.query.category ?? "").trim().toLowerCase();
    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);

    let keyToUse = providerKey;
    if (!keyToUse) {
      const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
      keyToUse = cfg?.marketDataActiveProviderKey ? String(cfg.marketDataActiveProviderKey) : null;
    }
    if (!keyToUse) return res.status(400).json({ ok: false, error: "No providerKey (and no active provider configured)" });

    const clauses: string[] = ["provider_key = $1"];
    const params: any[] = [keyToUse];
    let idx = params.length;

    if (category) {
      params.push(category);
      idx = params.length;
      clauses.push(`category = $${idx}`);
    }

    if (q) {
      params.push(`%${q}%`);
      idx = params.length;
      clauses.push(`(canonical_symbol ILIKE $${idx} OR provider_symbol ILIKE $${idx} OR name ILIKE $${idx})`);
    }

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const sqlQuery = `
      SELECT
        id,
        provider_key AS "providerKey",
        category,
        canonical_symbol AS "canonicalSymbol",
        provider_symbol AS "providerSymbol",
        name,
        currency,
        exchange,
        country,
        type,
        currency_base AS "currencyBase",
        currency_quote AS "currencyQuote",
        region,
        last_refreshed_at AS "lastRefreshedAt"
      FROM instrument_reference
      WHERE ${clauses.join(" AND ")}
      ORDER BY canonical_symbol ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const rows = await dbClient.query(sqlQuery, params);
    res.json({ ok: true, providerKey: keyToUse, rows: rows.rows });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.post("/instruments/reference/enable", async (req, res) => {
  try {
    const providerKey = normalizeProviderKey(req.body?.providerKey);
    const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = idsRaw.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n)).slice(0, 500);
    if (!ids.length) return res.status(400).json({ ok: false, error: "ids required" });

    let keyToUse = providerKey;
    if (!keyToUse) {
      const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
      keyToUse = cfg?.marketDataActiveProviderKey ? String(cfg.marketDataActiveProviderKey) : null;
    }
    if (!keyToUse) return res.status(400).json({ ok: false, error: "No providerKey (and no active provider configured)" });

    const refRows = await db
      .select()
      .from(instrumentReference)
      .where(and(eq(instrumentReference.providerKey, keyToUse), inArray(instrumentReference.id, ids)));

    if (!refRows.length) return res.status(404).json({ ok: false, error: "No reference rows found" });

    const defaults = await db.select().from(pipCategoryDefaults);
    const defaultsByCategory = new Map<string, any>();
    for (const d of defaults as any[]) defaultsByCategory.set(String(d.category), d);

    const providerMappers = await loadDefaultProviderSymbolMappers();

    const enabled: any[] = [];
    for (const r of refRows as any[]) {
      const symbol = String(r.canonicalSymbol);
      const existing = await db.query.symbolConfigs.findFirst({ where: eq(symbolConfigs.symbol, symbol) });

      const cat = String(r.category || "").toLowerCase();
      const pipDefault = defaultsByCategory.get(cat);
      const isJpyForex = cat === "forex" && String(r.currencyQuote || "").toUpperCase() === "JPY";
      const pipDecimals = isJpyForex ? 2 : pipDefault?.pipDecimals ?? null;
      const quoteDecimals = isJpyForex ? 3 : (pipDefault?.quoteDecimals ?? null);

      const mergedMap = safeJsonParseObject(existing?.providerSymbolMapJson ?? "{}");
      mergedMap[keyToUse] = String(r.providerSymbol);

      // Populate missing provider symbol mappings where possible, to make switching seamless.
      for (const m of providerMappers) {
        if (mergedMap[m.providerKey]) continue;
        const mapped = m.mapSymbol(symbol);
        if (mapped) mergedMap[m.providerKey] = mapped;
      }

      const baseCurrency = r.currencyBase ? String(r.currencyBase) : /^[A-Z]{6}$/.test(symbol) ? symbol.slice(0, 3) : null;
      const quoteCurrency = r.currencyQuote ? String(r.currencyQuote) : /^[A-Z]{6}$/.test(symbol) ? symbol.slice(3) : null;

      const values: any = {
        symbol,
        name: String(r.name ?? symbol),
        category: cat || null,
        baseCurrency,
        quoteCurrency,
        enabled: true,
        pipDecimals,
        quoteDecimals,
        providerSymbolMapJson: JSON.stringify(mergedMap),
      };

      if (existing) {
        await db.update(symbolConfigs).set(values).where(eq(symbolConfigs.id, existing.id));
        enabled.push({ symbol, action: "updated" });
      } else {
        await db.insert(symbolConfigs).values(values);
        enabled.push({ symbol, action: "created" });
      }
    }

    try {
      publishLiveEvent({
        type: "symbols:updated",
        payload: { action: "bulk-enabled", providerKey: keyToUse, count: enabled.length, at: Date.now() },
      });
    } catch {
      // ignore
    }

    res.json({ ok: true, providerKey: keyToUse, enabled });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// ===== Pip Defaults =====

adminMarketDataRouter.get("/pip-defaults", async (_req, res) => {
  try {
    const rows = await db.select().from(pipCategoryDefaults).orderBy(asc(pipCategoryDefaults.category));
    res.json({ ok: true, rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminMarketDataRouter.put("/pip-defaults/:category", async (req, res) => {
  try {
    const category = String(req.params.category ?? "").trim().toLowerCase();
    if (!category) return res.status(400).json({ ok: false, error: "category required" });

    const pipDecimals = Number(req.body?.pipDecimals);
    const quoteDecimals = req.body?.quoteDecimals == null ? null : Number(req.body.quoteDecimals);

    if (!Number.isFinite(pipDecimals) || pipDecimals < 0 || pipDecimals > 12) {
      return res.status(400).json({ ok: false, error: "pipDecimals must be 0..12" });
    }
    if (quoteDecimals != null && (!Number.isFinite(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 12)) {
      return res.status(400).json({ ok: false, error: "quoteDecimals must be 0..12 (or null)" });
    }

    const now = nowSec();
    const adminId = Number((req.session as any)?.userId ?? 0) || null;

    await db
      .insert(pipCategoryDefaults)
      .values({
        category,
        pipDecimals: Math.trunc(pipDecimals),
        quoteDecimals: quoteDecimals == null ? null : Math.trunc(quoteDecimals),
        updatedAt: now,
        updatedByAdminId: adminId,
      } as any)
      .onConflictDoUpdate({
        target: pipCategoryDefaults.category,
        set: {
          pipDecimals: Math.trunc(pipDecimals),
          quoteDecimals: quoteDecimals == null ? null : Math.trunc(quoteDecimals),
          updatedAt: now,
          updatedByAdminId: adminId,
        } as any,
      });

    const [row] = await db.select().from(pipCategoryDefaults).where(eq(pipCategoryDefaults.category, category)).limit(1);
    res.json({ ok: true, row });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});
