import { getIdentityHeaders } from "./identity";
import { attachCsrfHeader, isCsrfFailureResponse, refreshCsrfToken, shouldAttachCsrf } from "./csrf";

export async function fetchWithIdentity(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const identityHeaders = await getIdentityHeaders();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

  for (const [key, value] of Object.entries(identityHeaders)) {
    headers.set(key, value);
  }

  const baseInit: RequestInit = {
    ...(init ?? {}),
    headers,
  };

  let requestInit = await attachCsrfHeader(input, baseInit);
  let res = await fetch(input, requestInit);

  const canRetryCsrf = shouldAttachCsrf(input, baseInit) && !(input instanceof Request);
  if (canRetryCsrf && (await isCsrfFailureResponse(res))) {
    await refreshCsrfToken();
    requestInit = await attachCsrfHeader(input, baseInit, { forceRefresh: true });
    res = await fetch(input, requestInit);
  }

  return res;
}
