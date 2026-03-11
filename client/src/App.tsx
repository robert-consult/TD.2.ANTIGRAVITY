import { Suspense, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { installAxiosIdentityHeaders } from "./lib/axiosIdentity";
import { installGlobalCsrfFetch } from "./lib/csrf";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n";
import { MobileWrapperBridge } from "@/components/MobileWrapperBridge";
import { lazyWithPing } from "@/lib/lazyWithPing";
import {
  getQueryPersistence,
  PERSIST_QUERY_KEYS,
  QueryPersistence,
  subscribeQueryPersistenceReady,
} from "@/lib/queryPersistence";

installGlobalCsrfFetch();
installAxiosIdentityHeaders();

const LoginPage = lazyWithPing(() => import("@/pages/LoginPage"));
const VerifyEmail = lazyWithPing(() => import("@/pages/VerifyEmail"));
const AuthenticatedShell = lazyWithPing(() => import("@/AuthenticatedShell"));

function FullScreenLoading() {
  return (
    <div className="flex justify-center items-center min-h-screen min-h-dvh">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>
  );
}

function AppRoutes() {
  // Subscribe so i18n bundle/locale changes re-render the app.
  useI18n();
  const { isAuthenticated, loading } = useAuth();
  const [location, navigate] = useLocation();
  const currentPath = location.split("?")[0] ?? location;

  useEffect(() => {
    const isPublicRoute = currentPath === "/login" || currentPath === "/verify-email";
    if (!loading && !isAuthenticated && !isPublicRoute) {
      navigate("/login");
    }

    if (!loading && isAuthenticated && currentPath === "/login") {
      navigate("/");
    }
  }, [currentPath, isAuthenticated, loading, navigate]);

  if (loading) {
    return <FullScreenLoading />;
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<FullScreenLoading />}>
        <Switch>
          <Route path="/login" component={LoginPage} />
          <Route path="/verify-email" component={VerifyEmail} />
          <Route component={LoginPage} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<FullScreenLoading />}>
      <AuthenticatedShell />
    </Suspense>
  );
}

function App() {
  useEffect(() => {
    let persistenceUnsubscribe: (() => void) | null = null;

    const attachPersistence = (persistence: QueryPersistence | null) => {
      if (!persistence || persistenceUnsubscribe) return;
      persistenceUnsubscribe = persistence.subscribe();
      for (const key of PERSIST_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    };

    attachPersistence(getQueryPersistence());
    const unsubscribeReady = subscribeQueryPersistenceReady((persistence) => {
      attachPersistence(persistence);
    });

    return () => {
      unsubscribeReady();
      persistenceUnsubscribe?.();
      persistenceUnsubscribe = null;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <MobileWrapperBridge />
          <AppRoutes />
          <Toaster />
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
