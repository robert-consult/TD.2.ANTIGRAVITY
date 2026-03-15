import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import type { LessonPayload } from "@/lib/educationTypes";

type LessonPagerProps = {
  previousLesson: LessonPayload["previousLesson"];
  nextLesson: LessonPayload["nextLesson"];
};

export function LessonPager({ previousLesson, nextLesson }: LessonPagerProps) {
  if (!previousLesson && !nextLesson) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {previousLesson ? (
        <Link href={previousLesson.href}>
          <Card className="h-full border-border bg-card transition-colors hover:border-primary/40">
            <CardContent className="flex h-full items-center gap-3 p-4">
              <ChevronLeft className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Previous Lesson
                </p>
                <p className="mt-1 font-semibold text-foreground">{previousLesson.title}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      ) : (
        <div />
      )}

      {nextLesson ? (
        <Link href={nextLesson.href}>
          <Card className="h-full border-border bg-card transition-colors hover:border-primary/40">
            <CardContent className="flex h-full items-center justify-between gap-3 p-4 text-right">
              <div className="ml-auto">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Next Lesson
                </p>
                <p className="mt-1 font-semibold text-foreground">{nextLesson.title}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-primary" />
            </CardContent>
          </Card>
        </Link>
      ) : null}
    </div>
  );
}
