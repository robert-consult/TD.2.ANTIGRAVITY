import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import {
  getSecureCacheScope,
  secureClearAll,
  secureDelete,
  secureGet,
  securePut,
  setSecureCacheUserScope,
} from "@/lib/secureCache";
import { clearStaleData, markFreshData, markStaleData } from "@/lib/staleData";
import { useToast } from "@/hooks/use-toast";
import { prefetchStartupData } from "@/lib/startupDataPrefetch";

interface User {
  id: number;
  email: string;
  username: string;
  name?: string;
  phone?: string;
  countryIso2?: string | null;
  language?: string;
  balance: string;
  startingEquity?: number;
  equity?: number;
  freeMargin?: number;
  usedMargin?: number;
  leverage?: number;
  isAdmin?: boolean;
  createdAt?: string;
  // Tier system fields
  userTier?: "CANDIDATE" | "PERFORMER" | "SELECTED";
  contenderTier?: string;
  // Verification status for reminder popup
  emailVerified?: boolean;
  emailVerifiedAt?: number | null;
  inGracePeriod?: boolean;
  gracePeriodEndsAt?: number | null;
  // View As impersonation fields
  isImpersonating?: boolean;
  realAdminId?: number | null;
  realAdminEmail?: string | null;
  // Legal re-acceptance gate (DOC1)
  legalReacceptRequired?: boolean;
  legalReacceptBlocked?: boolean;
  legalReacceptBlockedReason?: string | null;
  legalRequiredCombinedSha256?: string | null;
  legalLastAcceptedCombinedSha256?: string | null;
}

interface RegisterOpts {
  countryIso2: string;
  termsToken: string;
  combinedSha256: string;
  captchaToken?: string | null;
  phone?: string | null;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  isCachedUserStale: boolean;
  login: (email: string, password: string, opts?: { rememberMe?: boolean }) => Promise<void>;
  register: (email: string, username: string, password: string, opts?: RegisterOpts) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
  stopImpersonating: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  loading: true,
  isCachedUserStale: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  checkAuth: async () => {},
  updateUser: () => {},
  stopImpersonating: async () => {},
});

function baseLocale(value?: string | null): string {
  return String(value || "").trim().toLowerCase().split("-")[0] || "";
}

const AUTH_CACHE_KEY = "auth.current-user";
const AUTH_CACHE_SCHEMA_VERSION = 1;
const AUTH_STALE_KEY = "/api/auth/current-user";

type CachedAuthRecord = {
  schemaVersion: number;
  user: User;
  cachedAt: number;
};

function normalizeCachedUser(value: unknown): User | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as User;
  const userId = Number((candidate as any).id);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (typeof (candidate as any).email !== "string") return null;
  return candidate;
}

function normalizeCachedAuthRecord(value: unknown): CachedAuthRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<CachedAuthRecord>;
  if (Number(record.schemaVersion) !== AUTH_CACHE_SCHEMA_VERSION) return null;
  const user = normalizeCachedUser(record.user);
  if (!user) return null;
  return {
    schemaVersion: AUTH_CACHE_SCHEMA_VERSION,
    user,
    cachedAt: Number(record.cachedAt || Date.now()),
  };
}

function applyStoredLocale(user: User | null): User | null {
  if (!user || typeof window === "undefined") return user;
  try {
    const stored = localStorage.getItem("i18n.locale");
    if (!stored) return user;
    const storedBase = baseLocale(stored);
    const userBase = baseLocale(user.language);
    if (!userBase || (userBase === "en" && storedBase && storedBase !== "en")) {
      return { ...user, language: stored };
    }
  } catch {
    // ignore storage failures
  }
  return user;
}

type AuthSecurityCode = "ABSENCE_REAUTH_REQUIRED" | "TOKEN_THEFT_DETECTED";

function resolveAuthSecurityCode(error: unknown): AuthSecurityCode | null {
  if (!(error instanceof ApiError)) return null;
  const code = String(error.code || "").trim().toUpperCase();
  if (code === "ABSENCE_REAUTH_REQUIRED" || code === "TOKEN_THEFT_DETECTED") {
    return code;
  }
  return null;
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCachedUserStale, setIsCachedUserStale] = useState(false);
  const activeUserIdRef = useRef<number | null>(null);
  const lastSecurityNoticeRef = useRef<{ code: AuthSecurityCode; atMs: number } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const persistAuthState = useCallback(async (nextUser: User | null) => {
    if (nextUser) {
      await securePut<CachedAuthRecord>("user-state", AUTH_CACHE_KEY, {
        schemaVersion: AUTH_CACHE_SCHEMA_VERSION,
        user: nextUser,
        cachedAt: Date.now(),
      });
      return;
    }
    await secureDelete("user-state", AUTH_CACHE_KEY).catch(() => undefined);
  }, []);

  const warmAuthenticatedStartup = useCallback(() => {
    prefetchStartupData({
      queryClient,
      phase: "authenticated",
      startDelayMs: 0,
    });
  }, [queryClient]);

  const alignSecureCacheScope = useCallback(
    async (nextUserId: number | null) => {
      const currentScope = getSecureCacheScope();
      const nextScope = Number.isInteger(nextUserId) && nextUserId && nextUserId > 0
        ? `user:${nextUserId}`
        : "app";
      if (currentScope !== nextScope) {
        await secureClearAll();
        clearStaleData();
      }
      await setSecureCacheUserScope(nextUserId);
      activeUserIdRef.current = nextUserId;
    },
    [],
  );

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const checkAuthInternal = useCallback(async (options?: { background?: boolean }) => {
    const background = Boolean(options?.background);
    try {
      if (!background) {
        setLoading(true);
      }
      const res = await apiRequest("GET", "/api/auth/current-user");
      const data = await res.json();
      const nextUser = applyStoredLocale(data);
      const nextUserId =
        nextUser && Number.isInteger(Number(nextUser.id)) && Number(nextUser.id) > 0
          ? Number(nextUser.id)
          : null;
      await alignSecureCacheScope(nextUserId);
      setUser(nextUser);
      setIsCachedUserStale(false);
      markFreshData(AUTH_STALE_KEY);
      await persistAuthState(nextUser);
      if (nextUserId) {
        warmAuthenticatedStartup();
      }
    } catch (error) {
      const unauthorized = error instanceof ApiError && error.status === 401;
      if (unauthorized) {
        const securityCode = resolveAuthSecurityCode(error);
        const nowMs = Date.now();
        const shouldShowSecurityNotice =
          securityCode &&
          (!lastSecurityNoticeRef.current ||
            lastSecurityNoticeRef.current.code !== securityCode ||
            nowMs - lastSecurityNoticeRef.current.atMs > 15_000);

        if (securityCode === "TOKEN_THEFT_DETECTED") {
          await secureClearAll();
          clearStaleData();
        }

        await alignSecureCacheScope(null);
        setUser(null);
        setIsCachedUserStale(false);
        markFreshData(AUTH_STALE_KEY);
        await persistAuthState(null);

        if (shouldShowSecurityNotice && securityCode) {
          lastSecurityNoticeRef.current = { code: securityCode, atMs: nowMs };
          if (securityCode === "ABSENCE_REAUTH_REQUIRED") {
            toast({
              title: "Please log in again",
              description: "For your security, your remembered session expired after inactivity.",
              variant: "destructive",
            });
          } else if (securityCode === "TOKEN_THEFT_DETECTED") {
            toast({
              title: "Security alert",
              description: "We detected a token mismatch and signed out remembered sessions. Please log in again.",
              variant: "destructive",
            });
          }
        }
      } else if (background || activeUserIdRef.current !== null) {
        setIsCachedUserStale(true);
        markStaleData(AUTH_STALE_KEY);
      } else {
        setUser(null);
        setIsCachedUserStale(false);
        markFreshData(AUTH_STALE_KEY);
      }
    } finally {
      setLoading(false);
    }
  }, [alignSecureCacheScope, persistAuthState, toast, warmAuthenticatedStartup]);

  const checkAuth = useCallback(async () => {
    await checkAuthInternal();
  }, [checkAuthInternal]);

  const login = async (email: string, password: string, opts?: { rememberMe?: boolean }) => {
    try {
      setLoading(true);
      const res = await apiRequest("POST", "/api/auth/login", {
        email,
        password,
        rememberMe: Boolean(opts?.rememberMe),
      });
      const data = await res.json();
      const nextUser = applyStoredLocale(data);
      const nextUserId =
        nextUser && Number.isInteger(Number(nextUser.id)) && Number(nextUser.id) > 0
          ? Number(nextUser.id)
          : null;
      await alignSecureCacheScope(nextUserId);
      setUser(nextUser);
      setIsCachedUserStale(false);
      markFreshData(AUTH_STALE_KEY);
      await persistAuthState(nextUser);
      queryClient.clear();
      warmAuthenticatedStartup();
    } catch (error) {
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, username: string, password: string, opts?: RegisterOpts) => {
    try {
      setLoading(true);
      const res = await apiRequest("POST", "/api/auth/register", { 
        email, 
        username, 
        password,
        ...(opts || {}),
      });
      const data = await res.json();
      const nextUser = applyStoredLocale(data);
      const nextUserId =
        nextUser && Number.isInteger(Number(nextUser.id)) && Number(nextUser.id) > 0
          ? Number(nextUser.id)
          : null;
      await alignSecureCacheScope(nextUserId);
      setUser(nextUser);
      setIsCachedUserStale(false);
      markFreshData(AUTH_STALE_KEY);
      await persistAuthState(nextUser);
      queryClient.clear();
      warmAuthenticatedStartup();
    } catch (error) {
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      setLoading(true);
      const userId = user?.id;
      await apiRequest("POST", "/api/auth/logout");
      if (userId) {
        sessionStorage.removeItem(`verification_reminder_dismissed_${userId}`);
      }
      await secureClearAll();
      await setSecureCacheUserScope(null);
      setUser(null);
      activeUserIdRef.current = null;
      setIsCachedUserStale(false);
      markFreshData(AUTH_STALE_KEY);
      clearStaleData();
      queryClient.clear();
      await persistAuthState(null);
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setLoading(false);
    }
  };

  const stopImpersonating = async () => {
    try {
      setLoading(true);
      const res = await apiRequest("POST", "/api/admin/view-as/stop");
      const data = await res.json();
      if (data.success) {
        // Refresh user data to get back to admin session
        await checkAuthInternal();
        queryClient.clear();
        warmAuthenticatedStartup();
      }
    } catch (error) {
      console.error("Stop impersonation error:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Check auth on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = normalizeCachedAuthRecord(await secureGet<CachedAuthRecord>("user-state", AUTH_CACHE_KEY));
      if (cached && !cancelled) {
        await setSecureCacheUserScope(cached.user.id);
        setUser(applyStoredLocale(cached.user));
        activeUserIdRef.current = Number(cached.user.id);
        setLoading(false);
        setIsCachedUserStale(true);
        markStaleData(AUTH_STALE_KEY);
      }
      await checkAuthInternal({ background: Boolean(cached) });
    })();

    return () => {
      cancelled = true;
    };
  }, [checkAuthInternal]);

  useEffect(() => {
    if (!user) return;
    void persistAuthState(user);
  }, [persistAuthState, user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        isCachedUserStale,
        login,
        register,
        logout,
        checkAuth,
        updateUser,
        stopImpersonating,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};

// Wrap your application with this provider
export const withAuth = (Component: React.ComponentType) => {
  return function WithAuth(props: any) {
    return (
      <AuthProvider>
        <Component {...props} />
      </AuthProvider>
    );
  };
};
