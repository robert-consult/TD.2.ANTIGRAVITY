import {
  CSRF_HEADER_NAME,
  CSRF_TOKEN_ENDPOINT,
} from "@shared/security/csrf";

let csrfTokenPromise: Promise<string | null> | null = null;

export async function fetchCsrfToken(): Promise<string | null> {
  if (csrfTokenPromise) {
    return csrfTokenPromise;
  }

  csrfTokenPromise = (async () => {
    try {
      const response = await fetch(CSRF_TOKEN_ENDPOINT, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return typeof payload?.csrfToken === "string" ? payload.csrfToken : null;
    } catch {
      return null;
    } finally {
      csrfTokenPromise = null;
    }
  })();

  return csrfTokenPromise;
}

export async function fetchWithCsrf(url: string, init: RequestInit): Promise<Response> {
  const token = await fetchCsrfToken();
  const headers = new Headers(init.headers ?? {});
  if (token) {
    headers.set(CSRF_HEADER_NAME, token);
  }
  return fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });
}
