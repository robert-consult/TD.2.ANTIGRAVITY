type CurrencyCode = "USD" | "EUR" | "GBP" | "CHF" | "JPY";

const EUR_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR",
  "HU", "IE", "IS", "IT", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO",
  "SE", "SI", "SK",
]);
const GBP_COUNTRIES = new Set(["GB", "GG", "IM", "JE"]);
const CHF_COUNTRIES = new Set(["CH", "LI"]);
const JPY_COUNTRIES = new Set(["JP"]);

export function defaultPaymentCurrencyForCountry(args: {
  countryIso2?: string | null;
  regionKey?: string | null;
}): CurrencyCode {
  const iso2 = String(args.countryIso2 ?? "").trim().toUpperCase();
  const regionKey = String(args.regionKey ?? "").trim().toUpperCase();

  if (GBP_COUNTRIES.has(iso2)) return "GBP";
  if (CHF_COUNTRIES.has(iso2)) return "CHF";
  if (JPY_COUNTRIES.has(iso2)) return "JPY";
  if (EUR_COUNTRIES.has(iso2)) return "EUR";

  if (regionKey === "WEST_EUROPE" || regionKey === "EAST_EUROPE") return "EUR";
  return "USD";
}
