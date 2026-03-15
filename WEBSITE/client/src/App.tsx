import { Suspense, lazy } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";

const NotFound = lazy(() => import("@/pages/not-found"));
const HomePage = lazy(() => import("@/pages/HomePage"));
const MarketDashboardPage = lazy(() => import("@/pages/MarketDashboardPage"));
const EducationPage = lazy(() => import("@/pages/EducationPage"));
const EducationModulePage = lazy(() => import("@/pages/EducationModulePage"));
const EducationLessonPage = lazy(() => import("@/pages/EducationLessonPage"));
const ContactPage = lazy(() => import("@/pages/ContactPage"));
const PlatformGuidePage = lazy(() => import("@/pages/PlatformGuidePage"));
const PlatformGuideLessonPage = lazy(() => import("@/pages/PlatformGuideLessonPage"));

/**
 * Public website router — NO authentication, NO protected routes.
 *
 * Login/Signup buttons across the site use native <a> tags to redirect
 * to tradehub.example.com (configured in lib/app-config.ts).
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <Switch>
          {/* Public pages */}
          <Route path="/" component={HomePage} />
          <Route path="/dashboard" component={MarketDashboardPage} />
          <Route path="/education" component={EducationPage} />
          <Route path="/education/:moduleSlug/:lessonSlug" component={EducationLessonPage} />
          <Route path="/education/:moduleSlug" component={EducationModulePage} />
          <Route path="/platform-guide/:lessonSlug" component={PlatformGuideLessonPage} />
          <Route path="/platform-guide" component={PlatformGuidePage} />
          <Route path="/contact" component={ContactPage} />

          {/* 404 */}
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </QueryClientProvider>
  );
}

export default App;
