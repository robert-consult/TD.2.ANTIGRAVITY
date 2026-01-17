import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

interface User {
  id: number;
  email: string;
  username: string;
  name?: string;
  phone?: string;
  countryIso2?: string | null;
  language?: string;
  balance: string;
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
  login: (email: string, password: string) => Promise<void>;
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

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiRequest("GET", "/api/auth/current-user");
      const data = await res.json();
      setUser(applyStoredLocale(data));
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    try {
      setLoading(true);
      const res = await apiRequest("POST", "/api/auth/login", { email, password });
      const data = await res.json();
      setUser(applyStoredLocale(data));
      queryClient.invalidateQueries();
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
      setUser(applyStoredLocale(data));
      queryClient.invalidateQueries();
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
      setUser(null);
      queryClient.clear();
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
        await checkAuth();
        queryClient.invalidateQueries();
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
    checkAuth();
  }, [checkAuth]);

  // Poll balance every 2 seconds when authenticated
  useEffect(() => {
    if (!user) return;
    
    const interval = setInterval(async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/current-user");
        const data = await res.json();
        setUser(applyStoredLocale(data));
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setUser(null);
          queryClient.clear();
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [user?.id]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
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
