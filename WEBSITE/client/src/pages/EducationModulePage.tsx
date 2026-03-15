import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CourseLayout } from "@/components/education/CourseLayout";
import { DisclosureStack } from "@/components/education/DisclosureStack";
import { LessonFlagBanner } from "@/components/education/LessonFlagBanner";
import { educationApi } from "@/lib/educationApi";
import type { ModulePayload } from "@/lib/educationTypes";

export default function EducationModulePage() {
  const params = useParams<{ moduleSlug: string }>();
  const moduleSlug = params.moduleSlug;

  const { data, isLoading, error } = useQuery<ModulePayload>({
    queryKey: [educationApi.module(moduleSlug)],
    enabled: Boolean(moduleSlug),
  });

  if (isLoading) {
    return <div className="min-h-screen bg-background" />;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-destructive">
        Unable to load this module right now.
      </div>
    );
  }

  return (
    <CourseLayout
      eyebrow={data.trackType === "optionalExtension" ? "Optional Extension" : "Education Module"}
      title={data.publicTitle}
      summary={data.cardSummary}
      sidebarTitle={data.publicTitle}
      overviewHref={data.baseRoute}
      lessons={data.lessons.map((lesson) => ({
        lessonSlug: lesson.lessonSlug,
        title: lesson.title,
        href: lesson.href,
      }))}
      headerContent={
        <div className="space-y-4">
          <LessonFlagBanner flags={data.flags} />
          <div className="text-sm text-muted-foreground">
            {data.lessonCount} lessons · {data.quizItemCount} quiz items
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <DisclosureStack disclosures={data.disclosures} placement="top" />

        <section className="grid gap-4 md:grid-cols-2">
          {data.lessons.map((lesson) => (
            <Card key={lesson.lessonSlug} className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-xl">{lesson.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  {lesson.summary}
                </p>
                <Link href={lesson.href}>
                  <Button variant="outline" className="w-full justify-between">
                    Open lesson
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>

        <DisclosureStack disclosures={data.disclosures} placement="bottom" />
      </div>
    </CourseLayout>
  );
}
