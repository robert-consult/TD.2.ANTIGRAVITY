import type { MarketDataProviderConfig } from "@shared/marketDataProviders";
import type { MarketDataProvider } from "./providerTypes";
import { TwelveDataProvider } from "./providers/twelvedata";
import { OneForgeProvider } from "./providers/oneforge";
import { GenericRestV1Provider } from "./providers/genericRestV1";
import { wrapProviderWithRateLimit } from "./rateLimit";

export function buildProviderFromConfig(args: {
  providerKey: string;
  displayName: string;
  cfg: MarketDataProviderConfig;
}): MarketDataProvider {
  const rawProvider = (() => {
  switch (args.cfg.driver) {
    case "twelvedata":
      return new TwelveDataProvider({ providerKey: args.providerKey, displayName: args.displayName, cfg: args.cfg });
    case "oneforge":
      return new OneForgeProvider({ providerKey: args.providerKey, displayName: args.displayName, cfg: args.cfg });
    case "generic_rest_v1":
      return new GenericRestV1Provider({ providerKey: args.providerKey, displayName: args.displayName, cfg: args.cfg });
    default:
      throw new Error(`Unsupported provider driver: ${(args.cfg as any).driver}`);
  }
  })();

  return wrapProviderWithRateLimit(rawProvider, args.cfg);
}
