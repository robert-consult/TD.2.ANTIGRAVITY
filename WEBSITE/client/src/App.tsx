import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/HomePage";
import MarketDashboardPage from "@/pages/MarketDashboardPage";
import EducationPage from "@/pages/EducationPage";
import ContactPage from "@/pages/ContactPage";

/**
 * Public website router — NO authentication, NO protected routes.
 *
 * Login/Signup buttons across the site use native <a> tags to redirect
 * to tradehub.example.com (configured in lib/app-config.ts).
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Switch>
        {/* Public pages */}
        <Route path="/" component={HomePage} />
        <Route path="/dashboard" component={MarketDashboardPage} />
        <Route path="/education" component={EducationPage} />
        <Route path="/contact" component={ContactPage} />

        {/* 404 */}
        <Route component={NotFound} />
      </Switch>
    </QueryClientProvider>
  );
}

export default App;
