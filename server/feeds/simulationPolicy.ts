export function isSimulatedQuotesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const quoteSource = String(env.QUOTE_SOURCE ?? "").toLowerCase();
  return env.NODE_ENV !== "production" || env.ALLOW_SIMULATED_QUOTES === "true" || quoteSource === "simulated";
}
