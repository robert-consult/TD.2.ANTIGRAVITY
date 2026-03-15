import { Link } from "wouter";
import { cn } from "@/lib/utils";

type CourseSidebarProps = {
  title: string;
  overviewHref: string;
  overviewLabel?: string;
  lessons: Array<{
    lessonSlug: string;
    title: string;
    href: string;
  }>;
  activeLessonSlug?: string;
};

export function CourseSidebar({
  title,
  overviewHref,
  overviewLabel = "Module Overview",
  lessons,
  activeLessonSlug,
}: CourseSidebarProps) {
  return (
    <aside className="education-sidebar lg:sticky lg:top-20">
      <div className="rounded-2xl border bg-card p-4">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Contents
        </p>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{title}</h2>

        <nav className="mt-4 flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          <Link
            href={overviewHref}
            className={cn(
              "min-w-fit rounded-xl border px-3 py-2 text-sm transition-colors",
              !activeLessonSlug
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {overviewLabel}
          </Link>

          {lessons.map((lesson) => (
            <Link
              key={lesson.lessonSlug}
              href={lesson.href}
              className={cn(
                "min-w-fit rounded-xl border px-3 py-2 text-sm transition-colors",
                lesson.lessonSlug === activeLessonSlug
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {lesson.title}
            </Link>
          ))}
        </nav>
      </div>
    </aside>
  );
}
