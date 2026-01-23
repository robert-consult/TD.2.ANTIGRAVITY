import { Suspense, useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { VerificationReminderPopup } from "@/components/VerificationReminderPopup";
import { LegalReacceptGate } from "@/components/LegalReacceptGate";
import { installAxiosIdentityHeaders } from "./lib/axiosIdentity";
import { startGriftPing } from "./lib/griftPing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n";
import { LiveUpdatesProvider } from "@/live/LiveUpdatesProvider";
import { AccountSummarySync } from "@/live/AccountSummarySync";
import { QuotesProvider } from "@/live/QuotesProvider";
import { ConfigSync } from "@/live/ConfigSync";
import { lazyWithPing, useLazyPing } from "@/lib/lazyWithPing";

installAxiosIdentityHeaders();

const NotFound = lazyWithPing(() => import("@/pages/not-found"));
const Dashboard = lazyWithPing(() => import("@/pages/Dashboard"));
const LoginPage = lazyWithPing(() => import("@/pages/LoginPage"));
const AdminDashboard = lazyWithPing(() => import("@/pages/AdminDashboard"));
const JournalPage = lazyWithPing(() => import("@/pages/JournalPage"));
const ProfileSettings = lazyWithPing(() => import("@/pages/ProfileSettings"));
const VerifyEmail = lazyWithPing(() => import("@/pages/VerifyEmail"));

function ImpersonationBanner() {
  const { user, stopImpersonating } = useAuth();
  const [stopping, setStopping] = useState(false);
  const [, navigate] = useLocation();

  if (!user?.isImpersonating) return null;

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopImpersonating();
      navigate("/admin");
    } catch (error) {
      console.error("Failed to stop impersonation:", error);
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-black px-gutter py-2 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-semibold shrink-0">View As Mode:</span>
        <span className="truncate">
          You are viewing as {user.email}
          <span className="hidden sm:inline"> (ID: {user.id})</span>
        </span>
      </div>
      <button
        onClick={handleStop}
        disabled={stopping}
        className="bg-black text-white px-4 py-1 rounded font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {stopping ? "Exiting..." : "Exit View As"}
      </button>
    </div>
  );
}

function FullScreenLoading() {
  return (
    <div className="flex justify-center items-center min-h-screen min-h-dvh">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>
  );
}

function AdminRoute() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!user) return;
    if (!user.isAdmin) navigate("/");
  }, [navigate, user]);

  if (!user?.isAdmin) {
    return (
      <div className="flex justify-center items-center min-h-screen min-h-dvh">
        <div className="text-sm text-muted-foreground">Not authorized</div>
      </div>
    );
  }

  return <AdminDashboard />;
}

function AppRoutes() {
  // Subscribe so i18n bundle/locale changes re-render the app.
  useI18n();
  // Subscribe so lazy-loaded route chunks can trigger a retry render when they resolve.
  useLazyPing();
  const { user, isAuthenticated, loading } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!isAuthenticated) return;
    const stop = startGriftPing({ intervalMs: 60_000 });
    return () => stop();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!loading && !isAuthenticated && location !== "/login") {
      navigate("/login");
    }
    
    if (!loading && isAuthenticated && location === "/login") {
      navigate("/");
    }
  }, [isAuthenticated, loading, location, navigate]);

  if (loading) {
    return <FullScreenLoading />;
  }

  return (
    <>
      <ImpersonationBanner />
      <ConfigSync />
      <AccountSummarySync />
      <VerificationReminderPopup />
      <LegalReacceptGate />
      <div className={user?.isImpersonating ? "pt-10" : ""}>
        <Suspense fallback={<FullScreenLoading />}>
          <Switch>
            <Route path="/login" component={LoginPage} />
            <Route path="/verify-email" component={VerifyEmail} />
            <Route path="/admin" component={AdminRoute} />
            <Route path="/journal" component={JournalPage} />
            <Route path="/profile" component={ProfileSettings} />
            <Route path="/" component={Dashboard} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </div>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <LiveUpdatesProvider>
            <QuotesProvider>
              <AppRoutes />
              <Toaster />
            </QuotesProvider>
          </LiveUpdatesProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
