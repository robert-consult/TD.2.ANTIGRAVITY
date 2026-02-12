export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_HEADER_FALLBACK_NAME = "x-xsrf-token";
export const CSRF_TOKEN_COOKIE_NAME = "XSRF-TOKEN";
export const CSRF_TOKEN_ENDPOINT = "/api/csrf";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function normalizeHttpMethod(method: string | null | undefined): string {
  return String(method || "GET").trim().toUpperCase();
}

export function isCsrfSafeMethod(method: string | null | undefined): boolean {
  return SAFE_METHODS.has(normalizeHttpMethod(method));
}
