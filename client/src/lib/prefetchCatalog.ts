export const PREFETCH_ROUTE_KEYS = [
  "QuotesScreen",
  "TradeScreen",
  "ChartScreen",
  "HistoryScreen",
  "AccountScreen",
  "LeaderboardScreen",
  "JournalPage",
  "ProfileSettings",
  "PartnerPortal",
] as const;

export type PrefetchRouteKey = (typeof PREFETCH_ROUTE_KEYS)[number];

export const PREFETCH_MANIFEST_HINT_BY_KEY: Record<string, string> = {
  Dashboard: "src/pages/Dashboard",
  QuotesScreen: "src/pages/QuotesScreen",
  TradeScreen: "src/pages/TradeScreen",
  ChartScreen: "src/pages/ChartScreen",
  HistoryScreen: "src/pages/HistoryScreen",
  AccountScreen: "src/pages/AccountScreen",
  LeaderboardScreen: "src/pages/LeaderboardScreen",
  JournalPage: "src/pages/JournalPage",
  ProfileSettings: "src/pages/ProfileSettings",
  PartnerPortal: "src/pages/PartnerPortal",
};

export const SW_INSTALL_PREFETCH_KEYS = [
  "Dashboard",
  "QuotesScreen",
  "TradeScreen",
  "ChartScreen",
  "HistoryScreen",
  "AccountScreen",
] as const;

export const SW_BURST_PREFETCH_MESSAGE = "prefetch:burst";
