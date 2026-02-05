import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@db";
import { marketDataProviders } from "@shared/schema";
import { MarketDataProviderConfigSchema, type MarketDataProviderConfig } from "@shared/marketDataProviders";
import { eq } from "drizzle-orm";
import { isEnvSecretRef } from "./secret";

export type ProviderConfigFileEnvelope = {
  providerKey: string;
  displayName: string;
  driver: string;
  config: MarketDataProviderConfig;
  isEnabled: boolean;
  sourceFiles: string[];
};

export type ProviderConfigFilesLoadResult = {
  dir: string;
  providers: ProviderConfigFileEnvelope[];
  errors: Array<{ file: string; error: string }>;
};

export type ProviderConfigFilesSyncMode = "create_missing" | "upsert";

function normalizeProviderKey(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v)) return null;
  return v;
}

function deriveProviderKeyFromFilename(filename: string): string | null {
  const base = path.basename(filename).replace(/\.json$/i, "");
  const cleaned = base.startsWith("provider-") ? base.slice("provider-".length) : base;
  return normalizeProviderKey(cleaned);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Apply RFC 7396 JSON Merge Patch.
 * - Objects merge recursively
 * - Arrays replace
 * - `null` deletes keys
 */
export function applyJsonMergePatch<T>(target: T, patch: unknown): T {
  if (!isPlainObject(patch)) return target;
  const base: any = isPlainObject(target) ? target : {};
  const out: any = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete out[key];
      continue;
    }

    const curValue = isPlainObject(out) ? out[key] : undefined;
    if (isPlainObject(patchValue) && isPlainObject(curValue)) {
      out[key] = applyJsonMergePatch(curValue, patchValue);
      continue;
    }

    out[key] = patchValue;
  }

  return out as T;
}

function resolveConfigDir(rawDir?: string): string {
  const raw = String(rawDir ?? process.env.MARKET_DATA_PROVIDER_CONFIG_DIR ?? "config/marketdata/providers").trim();
  const dir = raw || "config/marketdata/providers";
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

function validateNoRawSecrets(cfg: MarketDataProviderConfig): string | null {
  if (cfg.driver === "twelvedata") return isEnvSecretRef(cfg.apiKey) ? null : "twelvedata.apiKey must be an env: reference";
  if (cfg.driver === "oneforge") return isEnvSecretRef(cfg.apiKey) ? null : "oneforge.apiKey must be an env: reference";
  if (cfg.driver === "generic_rest_v1" && cfg.apiKey) {
    return isEnvSecretRef(cfg.apiKey) ? null : "generic_rest_v1.apiKey must be an env: reference";
  }
  return null;
}

function candidatePatchNames(providerKey: string, nodeEnv?: string | null): string[] {
  const out: string[] = [];
  const env = nodeEnv ? String(nodeEnv).trim() : "";
  out.push(`${providerKey}.patch.json`, `provider-${providerKey}.patch.json`);
  if (env) out.push(`${providerKey}.${env}.patch.json`, `provider-${providerKey}.${env}.patch.json`);
  out.push(`${providerKey}.local.patch.json`, `provider-${providerKey}.local.patch.json`);
  return out;
}

async function readJsonFile(fullPath: string): Promise<any> {
  const text = await fs.readFile(fullPath, "utf8");
  const parsed = safeJsonParse(text);
  if (parsed === null) throw new Error("INVALID_JSON");
  return parsed;
}

function toEnvelope(raw: any, fallbackKey: string | null, sourceFiles: string[]): ProviderConfigFileEnvelope {
  if (!isPlainObject(raw)) throw new Error("Expected JSON object");

  const providerKey = normalizeProviderKey(raw.providerKey ?? raw.key ?? fallbackKey);
  if (!providerKey) throw new Error("Invalid providerKey");

  const displayName = String(raw.displayName ?? raw.label ?? "").trim();
  if (!displayName) throw new Error("displayName required");

  const driver = String(raw.driver ?? raw.kind ?? "").trim();
  if (!driver) throw new Error("driver required");

  const configRaw = isPlainObject(raw.config) ? raw.config : isPlainObject(raw.configJson) ? raw.configJson : raw;
  const configCandidate = isPlainObject(configRaw) ? { ...configRaw } : {};
  if (!configCandidate.driver) configCandidate.driver = driver;
  if (String(configCandidate.driver) !== driver) throw new Error("config.driver must match driver");

  const config = MarketDataProviderConfigSchema.parse(configCandidate);
  const secretErr = validateNoRawSecrets(config);
  if (secretErr) throw new Error(secretErr);

  const isEnabled = typeof raw.isEnabled === "boolean" ? raw.isEnabled : true;

  return { providerKey, displayName, driver, config, isEnabled, sourceFiles };
}

export async function loadProviderConfigsFromDir(opts?: {
  dir?: string;
  nodeEnv?: string | null;
  includeExamples?: boolean;
  strictDir?: boolean;
}): Promise<ProviderConfigFilesLoadResult> {
  const dir = resolveConfigDir(opts?.dir);
  const nodeEnv = opts?.nodeEnv ?? process.env.NODE_ENV ?? null;
  const includeExamples = Boolean(opts?.includeExamples || String(process.env.MARKET_DATA_PROVIDER_FILE_SYNC_INCLUDE_EXAMPLES ?? "").trim() === "1");
  const strictDir = Boolean(opts?.strictDir);

  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch (e: any) {
    const code = String(e?.code ?? "");
    if (code === "ENOENT") return { dir, providers: [], errors: strictDir ? [{ file: dir, error: "DIR_NOT_FOUND" }] : [] };
    return { dir, providers: [], errors: [{ file: dir, error: `READDIR_FAILED:${code || "unknown"}` }] };
  }

  const jsonNames = names.filter((n) => n.toLowerCase().endsWith(".json"));
  const baseNames = jsonNames
    .filter((n) => !n.toLowerCase().endsWith(".patch.json"))
    .filter((n) => includeExamples || !n.toLowerCase().endsWith(".example.json"));

  const nameSet = new Set(jsonNames);

  const providers: ProviderConfigFileEnvelope[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const name of baseNames) {
    const fullPath = path.join(dir, name);
    const fallbackKey = deriveProviderKeyFromFilename(name);
    try {
      const baseRaw = await readJsonFile(fullPath);
      const providerKey = normalizeProviderKey(baseRaw?.providerKey ?? baseRaw?.key ?? fallbackKey);
      if (!providerKey) throw new Error("Invalid providerKey");

      let merged = baseRaw;
      const appliedFiles = [fullPath];

      for (const patchName of candidatePatchNames(providerKey, nodeEnv)) {
        if (!nameSet.has(patchName)) continue;
        const patchPath = path.join(dir, patchName);
        const patchRaw = await readJsonFile(patchPath);
        if (!isPlainObject(patchRaw)) throw new Error(`Patch must be a JSON object (${patchName})`);
        merged = applyJsonMergePatch(merged, patchRaw);
        if (merged && typeof merged === "object") {
          (merged as any).providerKey = providerKey;
          (merged as any).key = providerKey;
        }
        appliedFiles.push(patchPath);
      }

      const envelope = toEnvelope(merged, providerKey, appliedFiles);
      providers.push(envelope);
    } catch (e: any) {
      errors.push({ file: fullPath, error: String(e?.message ?? e) });
    }
  }

  providers.sort((a, b) => a.providerKey.localeCompare(b.providerKey));
  return { dir, providers, errors };
}

export async function syncProviderConfigsFromDirToDb(opts?: {
  dir?: string;
  nodeEnv?: string | null;
  mode?: ProviderConfigFilesSyncMode;
  includeExamples?: boolean;
  strictDir?: boolean;
}): Promise<{
  dir: string;
  mode: ProviderConfigFilesSyncMode;
  createdKeys: string[];
  updatedKeys: string[];
  skippedKeys: string[];
  errors: Array<{ file: string; error: string }>;
}> {
  const mode: ProviderConfigFilesSyncMode =
    opts?.mode ??
    (String(process.env.MARKET_DATA_PROVIDER_FILE_SYNC_MODE ?? "").trim() === "upsert" ? "upsert" : "create_missing");

  const loaded = await loadProviderConfigsFromDir({
    dir: opts?.dir,
    nodeEnv: opts?.nodeEnv,
    includeExamples: opts?.includeExamples,
    strictDir: opts?.strictDir,
  });
  const createdKeys: string[] = [];
  const updatedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const p of loaded.providers) {
    const existing = await db.query.marketDataProviders.findFirst({
      where: eq(marketDataProviders.providerKey, p.providerKey),
    });

    const now = Math.floor(Date.now() / 1000);

    if (!existing) {
      await db.insert(marketDataProviders).values({
        providerKey: p.providerKey,
        displayName: p.displayName,
        driver: p.driver,
        configJson: JSON.stringify(p.config),
        isEnabled: p.isEnabled,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as any);
      createdKeys.push(p.providerKey);
      continue;
    }

    const wasDeleted = existing.deletedAt != null;
    if (wasDeleted || mode === "upsert") {
      await db
        .update(marketDataProviders)
        .set({
          displayName: p.displayName,
          driver: p.driver,
          configJson: JSON.stringify(p.config),
          isEnabled: p.isEnabled,
          updatedAt: now,
          deletedAt: null,
        } as any)
        .where(eq(marketDataProviders.providerKey, p.providerKey));
      updatedKeys.push(p.providerKey);
      continue;
    }

    skippedKeys.push(p.providerKey);
  }

  return { dir: loaded.dir, mode, createdKeys, updatedKeys, skippedKeys, errors: loaded.errors };
}
