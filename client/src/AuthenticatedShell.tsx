import { Suspense, useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { VerificationReminderPopup } from "@/components/VerificationReminderPopup";
import { LegalReacceptGate } from "@/components/LegalReacceptGate";
import { LiveUpdatesProvider } from "@/live/LiveUpdatesProvider";
import { AccountSummarySync } from "@/live/AccountSummarySync";
import { QuotesProvider } from "@/live/QuotesProvider";
import { ConfigSync } from "@/live/ConfigSync";
import { lazyWithPing } from "@/lib/lazyWithPing";
import { prefetchAllRoutes } from "@/lib/routePrefetch";
import { startGriftPing } from "@/lib/griftPing";
import { usePerfHints } from "@/lib/perfHints";
import { usePerformanceSettings } from "@/hooks/use-performance-settings";

const NotFound = lazyWithPing(() => import("@/pages/not-found"));
const Dashboard = lazyWithPing(() => import("@/pages/Dashboard"));
const AdminDashboard = lazyWithPing(() => import("@/pages/AdminDashboard"));
const JournalPage = lazyWithPing(() => import("@/pages/JournalPage"));
const ProfileSettings = lazyWithPing(() => import("@/pages/ProfileSettings"));
const PartnerPortal = lazyWithPing(() => import("@/pages/PartnerPortal"));
const VerifyEmail = lazyWithPing(() => import("@/pages/VerifyEmail"));

function FullScreenLoading() {
  return (
    <div className="flex justify-center items-center min-h-screen min-h-dvh">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>
  );
}

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

export default function AuthenticatedShell() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const perfHints = usePerfHints();
  const perfSettings = usePerformanceSettings();

  useEffect(() => {
    const stop = startGriftPing({ intervalMs: 60_000 });
    return () => stop();
  }, []);

  useEffect(() => {
    prefetchAllRoutes({ hints: perfHints, settings: perfSettings });
  }, [perfHints, perfSettings]);

  useEffect(() => {
    if (location === "/login") {
      navigate("/");
    }
  }, [location, navigate]);

  return (
    <LiveUpdatesProvider>
      <QuotesProvider>
        <ImpersonationBanner />
        <ConfigSync />
        <AccountSummarySync />
        <VerificationReminderPopup />
        <LegalReacceptGate />
        <div className={user?.isImpersonating ? "pt-10" : ""}>
          <Suspense fallback={<FullScreenLoading />}>
            <Switch>
              <Route path="/login" component={Dashboard} />
              <Route path="/verify-email" component={VerifyEmail} />
              <Route path="/admin" component={AdminRoute} />
              <Route path="/journal" component={JournalPage} />
              <Route path="/profile" component={ProfileSettings} />
              <Route path="/partner" component={PartnerPortal} />
              <Route path="/" component={Dashboard} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </div>
      </QuotesProvider>
    </LiveUpdatesProvider>
  );
}
