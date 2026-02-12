import { normalizeHttpMethod } from "../security/csrf";

export const API_PATH_PREFIX = "/api";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isApiPath(pathname: string): boolean {
  return pathname === API_PATH_PREFIX || pathname.startsWith(`${API_PATH_PREFIX}/`);
}

export function isSafeHttpMethod(method: string | null | undefined): boolean {
  return SAFE_METHODS.has(normalizeHttpMethod(method));
}
