/**
 * Market hours service for determining when FX markets are open
 * FX markets: Sunday 22:00 UTC → Friday 22:00 UTC
 */

export function isFxMarketOpen(at = new Date()): boolean {
  const d = at.getUTCDay();      // 0=Sun ... 6=Sat
  const mins = at.getUTCHours() * 60 + at.getUTCMinutes();
  const openMins = 22 * 60; // 22:00 UTC

  if (d === 6) return false;                 // Sat - always closed
  if (d === 0 && mins < openMins) return false; // Sun before open
  if (d === 5 && mins >= openMins) return false; // Fri after close
  return true;
}

export function isMarketOpenForSymbol(symbol: string, at = new Date()): boolean {
  // Expand later per-asset. For now treat FX + metals as FX-hours.
  if (/^[A-Z]{6}$/.test(symbol) || /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)) return isFxMarketOpen(at);
  return isFxMarketOpen(at);
}
