import { useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import LoginPage from "@/pages/LoginPage";
import AdminDashboard from "@/pages/AdminDashboard";
import JournalPage from "@/pages/JournalPage";
import ProfileSettings from "@/pages/ProfileSettings";
import VerifyEmail from "@/pages/VerifyEmail";
import { useAuth } from "@/hooks/use-auth";
import { AuthProvider } from "./hooks/use-auth";
import { VerificationReminderPopup } from "@/components/VerificationReminderPopup";
import { LegalReacceptGate } from "@/components/LegalReacceptGate";
import { installAxiosIdentityHeaders } from "./lib/axiosIdentity";
import { startGriftPing } from "./lib/griftPing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n";
import { LiveUpdatesProvider } from "@/live/LiveUpdatesProvider";

installAxiosIdentityHeaders();

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

function AppRoutes() {
  // Subscribe so i18n bundle/locale changes re-render the app.
  useI18n();
  const { user, isAuthenticated, loading, checkAuth } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

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
    return (
      <div className="flex justify-center items-center min-h-screen min-h-dvh">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <>
      <ImpersonationBanner />
      <VerificationReminderPopup />
      <LegalReacceptGate />
      <div className={user?.isImpersonating ? "pt-10" : ""}>
        <Switch>
          <Route path="/login" component={LoginPage} />
          <Route path="/verify-email" component={VerifyEmail} />
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/journal" component={JournalPage} />
          <Route path="/profile" component={ProfileSettings} />
          <Route path="/" component={Dashboard} />
          <Route component={NotFound} />
        </Switch>
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
            <AppRoutes />
            <Toaster />
          </LiveUpdatesProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
