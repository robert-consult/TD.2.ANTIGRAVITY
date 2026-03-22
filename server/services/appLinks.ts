import { buildLoginPageUrl, buildVerifyEmailPageUrl, resolveServerAppBaseUrl } from "@shared/appSurfaceConfig";

function resolveServerMode(): "development" | "production" | "test" {
  const raw = String(process.env.NODE_ENV ?? "development").trim().toLowerCase();
  if (raw === "production") return "production";
  if (raw === "test") return "test";
  return "development";
}

export function getServerAppBaseUrl(): string {
  return resolveServerAppBaseUrl(process.env.APP_URL, { mode: resolveServerMode() });
}

export function buildServerLoginUrl(): string {
  return buildLoginPageUrl(getServerAppBaseUrl(), "login");
}

export function buildServerSignupUrl(): string {
  return buildLoginPageUrl(getServerAppBaseUrl(), "register");
}

export function buildServerVerifyEmailUrl(token: string): string {
  return buildVerifyEmailPageUrl(getServerAppBaseUrl(), token);
}
