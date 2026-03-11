/**
 * Centralized configuration for the trading application URL.
 *
 * The public website (example.com) links to the trading app at tradehub.example.com
 * using native <a> tags — NOT wouter <Link> — because they are separate origins.
 *
 * To change the trading app domain, edit ONLY this file. All pages and components
 * import these constants instead of hardcoding URLs.
 */
export const APP_CONFIG = {
  /** Base URL of the trading application */
  tradingAppUrl: "https://tradehub.example.com/",

  /** Direct link to the login page on the trading app */
  loginUrl: "https://tradehub.example.com/login?tab=login",

  /** Direct link to the registration tab on the trading app */
  signupUrl: "https://tradehub.example.com/login?tab=register",
} as const;
