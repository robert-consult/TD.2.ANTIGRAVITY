import {
  CSRF_HEADER_NAME,
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_ENDPOINT,
  isCsrfSafeMethod,
  normalizeHttpMethod,
} from "@shared/security/csrf";
import { resolveApiUrl } from "./appUrl";

const API_PREFIX = "/api";
const CSRF_TOKEN_MIN_LEN = 32;
const CSRF_TOKEN_MAX_LEN = 256;
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const CSRF_FAILURE_CODE = "CSRF_TOKEN_INVALID";

let globalFetchInstalled = false;
let csrfTokenCache: string | null = null;
let csrfTokenFetchPromise: Promise<string | null> | null = null;

type CsrfAttachOptions = {
  forceRefresh?: boolean;
};

function normalizeToken(raw: unknown): string | null {
  const token = String(raw ?? "").trim();
  if (!token) return null;
  if (token.length < CSRF_TOKEN_MIN_LEN || token.length > CSRF_TOKEN_MAX_LEN) return null;
  if (!CSRF_TOKEN_PATTERN.test(token)) return null;
  return token;
}

function parseCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookieHeader = document.cookie ?? "";
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");
  for (const entry of cookies) {
    const [key, ...rest] = entry.trim().split("=");
    if (key !== name) continue;
    const rawValue = rest.join("=");
    try {
      const decodedValue = decodeURIComponent(rawValue);
      return decodedValue ? decodedValue.trim() : null;
    } catch {
      return rawValue ? rawValue.trim() : null;
    }
  }

  return null;
}

function readCookieToken(): string | null {
  const token = normalizeToken(parseCookieValue(CSRF_TOKEN_COOKIE_NAME));
  if (token) csrfTokenCache = token;
  return token ?? csrfTokenCache;
}

function resolveRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return normalizeHttpMethod(init.method);
  if (input instanceof Request) return normalizeHttpMethod(input.method);
  return "GET";
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  if (typeof window === "undefined") return null;
  const raw =
    input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
  try {
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

function resolveRawUrl(rawUrl: string | undefined | null): URL | null {
  if (!rawUrl || typeof window === "undefined") return null;
  try {
    return new URL(rawUrl, window.location.origin);
  } catch {
    return null;
  }
}

function isApiPathname(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

export function shouldAttachCsrf(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = resolveRequestMethod(input, init);
  if (isCsrfSafeMethod(method)) return false;
  const url = resolveRequestUrl(input);
  if (!url) return false;
  return isApiPathname(url.pathname);
}

export function shouldAttachCsrfToUrl(rawUrl: string | undefined, method: string | undefined): boolean {
  if (isCsrfSafeMethod(normalizeHttpMethod(method))) return false;
  const url = resolveRawUrl(rawUrl);
  if (!url) return false;
  return isApiPathname(url.pathname);
}

async function fetchCsrfToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const cookieToken = readCookieToken();
    if (cookieToken) return cookieToken;
    if (csrfTokenFetchPromise) return csrfTokenFetchPromise;
  }

  const task = (async () => {
    try {
      const res = await fetch(resolveApiUrl(CSRF_TOKEN_ENDPOINT), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return readCookieToken();

      let bodyToken: string | null = null;
      try {
        const payload = await res.json();
        bodyToken = normalizeToken((payload as { csrfToken?: unknown })?.csrfToken);
      } catch {
        bodyToken = null;
      }

      const cookieToken = readCookieToken();
      const resolved = cookieToken ?? bodyToken;
      if (resolved) csrfTokenCache = resolved;
      return resolved;
    } catch {
      return readCookieToken();
    }
  })();

  csrfTokenFetchPromise = task.finally(() => {
    csrfTokenFetchPromise = null;
  });
  return csrfTokenFetchPromise;
}

export async function refreshCsrfToken(): Promise<string | null> {
  return fetchCsrfToken(true);
}

export async function getCsrfTokenForUrl(
  rawUrl: string | undefined,
  method: string | undefined,
  options?: CsrfAttachOptions,
): Promise<string | null> {
  if (!shouldAttachCsrfToUrl(rawUrl, method)) return null;
  return fetchCsrfToken(Boolean(options?.forceRefresh));
}

export async function attachCsrfHeader(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: CsrfAttachOptions,
): Promise<RequestInit> {
  if (!shouldAttachCsrf(input, init)) return init ?? {};

  const token = await fetchCsrfToken(Boolean(options?.forceRefresh));
  if (!token) return init ?? {};

  const fallbackHeaders = input instanceof Request ? input.headers : undefined;
  const headers = new Headers(init?.headers ?? fallbackHeaders);
  headers.set(CSRF_HEADER_NAME, token);
  return { ...(init ?? {}), headers };
}

export function isCsrfFailurePayload(payload: unknown): boolean {
  const code = (payload as { code?: unknown } | null | undefined)?.code;
  return code === CSRF_FAILURE_CODE;
}

export async function isCsrfFailureResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const payload = await response.clone().json();
    return isCsrfFailurePayload(payload);
  } catch {
    return false;
  }
}

export function installGlobalCsrfFetch(): void {
  if (globalFetchInstalled || typeof window === "undefined") return;
  globalFetchInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const mutationRequest = shouldAttachCsrf(input, init);
    const nextInit = await attachCsrfHeader(input, init);
    let response = await nativeFetch(input, nextInit);

    if (mutationRequest && !(input instanceof Request) && (await isCsrfFailureResponse(response))) {
      await refreshCsrfToken();
      const retryInit = await attachCsrfHeader(input, init, { forceRefresh: true });
      response = await nativeFetch(input, retryInit);
    }

    return response;
  };
}
