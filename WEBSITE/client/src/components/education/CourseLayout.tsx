import type { ReactNode } from "react";
import { MarketingHeader } from "@/components/MarketingHeader";
import { CourseSidebar } from "./CourseSidebar";

type CourseLayoutProps = {
  eyebrow: string;
  title: string;
  summary: string;
  sidebarTitle: string;
  overviewHref: string;
  overviewLabel?: string;
  lessons: Array<{
    lessonSlug: string;
    title: string;
    href: string;
  }>;
  activeLessonSlug?: string;
  headerContent?: ReactNode;
  children: ReactNode;
};

export function CourseLayout({
  eyebrow,
  title,
  summary,
  sidebarTitle,
  overviewHref,
  overviewLabel,
  lessons,
  activeLessonSlug,
  headerContent,
  children,
}: CourseLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <main className="flex-1">
        <section className="border-b bg-card/70">
          <div className="container mx-auto px-4 py-10 md:px-6 md:py-14">
            <p className="text-xs uppercase tracking-[0.28em] text-primary">{eyebrow}</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground md:text-base">
              {summary}
            </p>
            {headerContent ? <div className="mt-6">{headerContent}</div> : null}
          </div>
        </section>

        <section className="container mx-auto px-4 py-8 md:px-6 md:py-10">
          <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
            <CourseSidebar
              title={sidebarTitle}
              overviewHref={overviewHref}
              overviewLabel={overviewLabel}
              lessons={lessons}
              activeLessonSlug={activeLessonSlug}
            />

            <div className="min-w-0">{children}</div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card py-8">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground md:px-6">
          © {new Date().getFullYear()} TradeQuip. Educational and informational use only.
        </div>
      </footer>
    </div>
  );
}
