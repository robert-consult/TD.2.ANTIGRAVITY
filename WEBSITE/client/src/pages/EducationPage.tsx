import { useQuery } from "@tanstack/react-query";
import { MarketingHeader } from "@/components/MarketingHeader";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APP_CONFIG } from "@/lib/app-config";
import { BookOpen, GraduationCap, TrendingUp } from "lucide-react";

type CourseModule = {
  slug: string;
  title: string;
  description: string;
  category: string;
  level?: "Beginner" | "Intermediate" | "Advanced";
  url?: string;
};

export default function EducationPage() {
  const { data, isLoading, error } = useQuery<CourseModule[]>({
    queryKey: ["/api/education/modules"],
  });

  const modules = data ?? [];

  const getLevelColor = (level?: string) => {
    switch (level) {
      case "Beginner":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "Intermediate":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "Advanced":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      default:
        return "bg-primary/10 text-primary border-primary/20";
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case "foundations":
        return <BookOpen className="w-5 h-5" />;
      case "tools":
        return <TrendingUp className="w-5 h-5" />;
      default:
        return <GraduationCap className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">
        <section className="border-b bg-card">
          <div className="container mx-auto px-4 py-10 md:px-6 md:py-16">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
              Knowledge is a wise investment.
            </h1>
            <p className="mt-3 max-w-2xl text-sm md:text-base text-muted-foreground">
              By combining easy-to-understand information with actionable insights,
              we help make the market approachable for traders at every level.
            </p>
          </div>
        </section>

        <section className="container mx-auto px-4 py-10 md:px-6 md:py-16">
          <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-foreground">Course Modules</h2>
            <a href={APP_CONFIG.tradingAppUrl}>
              <Button size="sm">
                Practice in TradeQuip
              </Button>
            </a>
          </div>

          {isLoading && (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-6 bg-muted rounded w-3/4 mb-2"></div>
                    <div className="h-4 bg-muted rounded w-full"></div>
                    <div className="h-4 bg-muted rounded w-2/3"></div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">
              Unable to load modules right now. Please try again later.
            </p>
          )}

          {!isLoading && !error && (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((mod) => (
                <Card key={mod.slug} className="flex flex-col justify-between hover:border-primary/50 transition-colors">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                          {getCategoryIcon(mod.category)}
                        </div>
                        <CardTitle className="text-lg">{mod.title}</CardTitle>
                      </div>
                      {mod.level && (
                        <Badge variant="outline" className={`text-xs ${getLevelColor(mod.level)}`}>
                          {mod.level}
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="mt-2">{mod.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex items-center justify-between pt-0">
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      {mod.category}
                    </span>
                    {mod.url && (
                      <a
                        href={mod.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        View details
                      </a>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t bg-card py-8">
        <div className="container mx-auto px-4 md:px-6 text-center text-sm text-muted-foreground space-y-2">
          <p>Education content is provided for informational purposes. Trading involves risk.</p>
          <p className="text-xs">© {new Date().getFullYear()} TradeQuip. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
