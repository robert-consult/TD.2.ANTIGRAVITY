import { getIdentityHeaders } from "./identity";

export async function fetchWithIdentity(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const identityHeaders = await getIdentityHeaders();
  const headers = new Headers(init?.headers ?? undefined);

  for (const [key, value] of Object.entries(identityHeaders)) {
    headers.set(key, value);
  }

  return fetch(input, { ...init, headers });
}

