import { db } from "@db/index";
import { globalSettings } from "@shared/schema";
import { sanitizeMinPriceDistancePips } from "@shared/tradingRules";
import { eq } from "drizzle-orm";
import { onLiveEvent } from "./liveBus";

const GLOBAL_SETTINGS_CACHE_TTL_MS = Number(process.env.GLOBAL_SETTINGS_CACHE_TTL_MS ?? 10_000);

type GlobalSettingsRow = typeof globalSettings.$inferSelect;

let cached: { fetchedAtMs: number; row: GlobalSettingsRow | null } | null = null;
let inflight: Promise<GlobalSettingsRow | null> | null = null;
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  onLiveEvent((event) => {
    if (event.type === "global-settings:updated") {
      cached = null;
    }
  });
}

export { sanitizeMinPriceDistancePips };

export async function getGlobalSettingsCached(): Promise<GlobalSettingsRow | null> {
  ensureSubscribed();
  const now = Date.now();
  if (cached && now - cached.fetchedAtMs < GLOBAL_SETTINGS_CACHE_TTL_MS) {
    return cached.row;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const row = await db.query.globalSettings.findFirst({
        where: eq(globalSettings.id, 1),
      });
      cached = { fetchedAtMs: Date.now(), row: row ?? null };
      return cached.row;
    } catch {
      return cached?.row ?? null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function invalidateGlobalSettingsCache() {
  cached = null;
}

export async function getMinPriceDistancePips(): Promise<number> {
  const gs = await getGlobalSettingsCached();
  return sanitizeMinPriceDistancePips(gs?.minPriceDistancePips);
}
