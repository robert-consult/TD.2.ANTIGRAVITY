import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BookOpen, Compass, Flag, ShieldAlert } from "lucide-react";
import { MarketingHeader } from "@/components/MarketingHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APP_CONFIG } from "@/lib/app-config";
import { educationApi } from "@/lib/educationApi";
import type { CatalogCard, EducationCatalog } from "@/lib/educationTypes";
import { LessonFlagBanner } from "@/components/education/LessonFlagBanner";

function CatalogCardItem({
  card,
  icon,
}: {
  card: CatalogCard;
  icon: ReactNode;
}) {
  return (
    <Link href={card.baseRoute}>
      <Card className="h-full border-border bg-card transition-colors hover:border-primary/40">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {icon}
            </div>
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {card.lessonCount} lessons
            </span>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-xl">{card.publicTitle}</CardTitle>
            <CardDescription className="leading-6">
              {card.cardSummary}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <LessonFlagBanner flags={card.flags} />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{card.status}</span>
            <span>Open module</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function EducationPage() {
  const { data, isLoading, error } = useQuery<EducationCatalog>({
    queryKey: [educationApi.catalog],
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <main className="flex-1">
        <section className="border-b bg-card/70">
          <div className="container mx-auto px-4 py-10 md:px-6 md:py-16">
            <p className="text-xs uppercase tracking-[0.28em] text-primary">
              Education Vanguard
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Structured lessons, built from the approved curriculum.
            </h1>
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground md:text-base">
              The website now publishes the approved Modules 1 through 10 as a
              structured learning surface. Modules 1 through 7 form the core
              curriculum, Module 8 expands into behavioral finance, Module 9
              remains visible with elevated crypto and compliance flags, and
              Module 10 lives as a separate platform guide with screenshot
              placeholders.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={APP_CONFIG.tradingAppUrl}>
                <Button>Practice in TradeQuip</Button>
              </a>
              <Link href="/platform-guide">
                <Button variant="outline">Open Platform Guide</Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="container mx-auto space-y-10 px-4 py-10 md:px-6 md:py-12">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Card key={index} className="h-64 animate-pulse border-border bg-card" />
              ))}
            </div>
          ) : null}

          {error ? (
            <Card className="border-destructive/30 bg-destructive/10">
              <CardContent className="p-6 text-sm text-destructive">
                Unable to load the education catalog right now.
              </CardContent>
            </Card>
          ) : null}

          {data ? (
            <>
              <section className="space-y-5">
                <div className="flex items-center gap-3">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <div>
                    <h2 className="text-2xl font-semibold">Core Curriculum</h2>
                    <p className="text-sm text-muted-foreground">
                      Modules 1 through 7 cover foundational mechanics, analysis,
                      risk, macro awareness, and performance review.
                    </p>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {data.core.map((card) => (
                    <CatalogCardItem
                      key={card.moduleSlug}
                      card={card}
                      icon={<Compass className="h-5 w-5" />}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-5">
                <div className="flex items-center gap-3">
                  <Flag className="h-5 w-5 text-primary" />
                  <div>
                    <h2 className="text-2xl font-semibold">Optional Extensions</h2>
                    <p className="text-sm text-muted-foreground">
                      Modules 8 and 9 extend the learning path with optional
                      behavioral-finance and crypto/DeFi material.
                    </p>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  {data.optionalExtensions.map((card) => (
                    <CatalogCardItem
                      key={card.moduleSlug}
                      card={card}
                      icon={<ShieldAlert className="h-5 w-5" />}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-5">
                <div className="flex items-center gap-3">
                  <Compass className="h-5 w-5 text-primary" />
                  <div>
                    <h2 className="text-2xl font-semibold">Platform Guide</h2>
                    <p className="text-sm text-muted-foreground">
                      Module 10 documents the authenticated TradeQuip product
                      with exact verified labels and screenshot placeholders.
                    </p>
                  </div>
                </div>

                <CatalogCardItem
                  card={data.platformGuide}
                  icon={<Compass className="h-5 w-5" />}
                />
              </section>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
