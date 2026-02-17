import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getIdentityHeaders } from "./identity";
import { solveBotChallenge } from "./botProof";
import { resolveApiUrl } from "./appUrl";
import { attachCsrfHeader, isCsrfFailureResponse, refreshCsrfToken } from "./csrf";
import { BOT_CHALLENGE_REQUIRED_CODE } from "@shared/security/botChallenge";
import { IDENTITY_HEADER_BOT_PROOF } from "@shared/identity/headers";
import { getPerfHints, tierRetryCount } from "./perfHints";

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.code = (data as any)?.code ?? (data as any)?.errorCode;
    this.data = data;
    this.name = "ApiError";
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    let errorData: any = null;
    try {
      errorData = JSON.parse(text);
      message = errorData.message || text || res.statusText;
    } catch {
      // If not JSON, use the text as-is
    }

    // Global compliance gate: prompt for legal re-acceptance when required (e.g., terms changed after last acceptance).
    if (errorData && (errorData.code === "LEGAL_REACCEPT_REQUIRED" || errorData.message === "LEGAL_REACCEPT_REQUIRED")) {
      try {
        window.dispatchEvent(new CustomEvent("legal:reaccept-required", { detail: errorData }));
      } catch {
        // ignore dispatch failures
      }
    }
    throw new ApiError(message, res.status, errorData ?? undefined);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const identityHeaders = await getIdentityHeaders();
  const baseHeaders: Record<string, string> = {
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...identityHeaders,
  };
  const resolvedUrl = resolveApiUrl(url);

  const doFetch = async (extra?: Record<string, string>, options?: { forceCsrfRefresh?: boolean }) => {
    const requestInit = await attachCsrfHeader(
      resolvedUrl,
      {
        method,
        headers: { ...baseHeaders, ...(extra ?? {}) },
        body: data ? JSON.stringify(data) : undefined,
        credentials: "include",
      },
      { forceRefresh: Boolean(options?.forceCsrfRefresh) },
    );

    return fetch(resolvedUrl, requestInit);
  };

  let res = await doFetch();
  if (await isCsrfFailureResponse(res)) {
    await refreshCsrfToken();
    res = await doFetch(undefined, { forceCsrfRefresh: true });
  }

  // Bot challenge loop (428 Precondition Required)
  if (res.status === 428) {
    const cloned = res.clone();
    let payload: any = null;
    try {
      payload = await cloned.json();
    } catch {
      payload = null;
    }

    if (payload?.code === BOT_CHALLENGE_REQUIRED_CODE && payload?.challenge) {
      const proof = await solveBotChallenge(payload.challenge, baseHeaders);
      res = await doFetch({ [IDENTITY_HEADER_BOT_PROOF]: proof });
      if (await isCsrfFailureResponse(res)) {
        await refreshCsrfToken();
        res = await doFetch({ [IDENTITY_HEADER_BOT_PROOF]: proof }, { forceCsrfRefresh: true });
      }
    }
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      const identityHeaders = await getIdentityHeaders();
      const url = resolveApiUrl(queryKey[0] as string);

      const res = await fetch(url, {
        credentials: "include",
        headers: identityHeaders,
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

function shouldSkipRetry(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return true;
    if (error.status >= 400 && error.status < 500) return true;
    return false;
  }

  const status = Number((error as any)?.status);
  if (Number.isFinite(status) && status >= 400 && status < 500) return true;
  return false;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: (failureCount, error) => {
        if (shouldSkipRetry(error)) return false;
        return failureCount < tierRetryCount(getPerfHints());
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
    mutations: {
      retry: false,
    },
  },
});
