import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseLayout } from "@/components/education/CourseLayout";
import { DisclosureStack } from "@/components/education/DisclosureStack";
import { InlineLessonQuiz } from "@/components/education/InlineLessonQuiz";
import { LessonFlagBanner } from "@/components/education/LessonFlagBanner";
import { LessonMetaBar } from "@/components/education/LessonMetaBar";
import { LessonPager } from "@/components/education/LessonPager";
import { ScreenshotPlaceholderCard } from "@/components/education/ScreenshotPlaceholderCard";
import { educationApi } from "@/lib/educationApi";
import type { LessonPayload } from "@/lib/educationTypes";

export default function PlatformGuideLessonPage() {
  const params = useParams<{ lessonSlug: string }>();
  const lessonSlug = params.lessonSlug;

  const { data, isLoading, error } = useQuery<LessonPayload>({
    queryKey: [educationApi.platformGuideLesson(lessonSlug)],
    enabled: Boolean(lessonSlug),
  });

  if (isLoading) {
    return <div className="min-h-screen bg-background" />;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-destructive">
        Unable to load this platform-guide lesson right now.
      </div>
    );
  }

  return (
    <CourseLayout
      eyebrow="Platform Guide Lesson"
      title={data.title}
      summary={data.summary}
      sidebarTitle={data.moduleTitle}
      overviewHref={data.moduleBaseRoute}
      overviewLabel="Guide Overview"
      lessons={data.sidebarLessons}
      activeLessonSlug={data.lessonSlug}
      headerContent={
        <div className="space-y-4">
          <LessonFlagBanner flags={data.flags} />
          <LessonMetaBar freshness={data.freshness} quizCount={data.quizItems.length} />
        </div>
      }
    >
      <div className="space-y-6">
        <DisclosureStack disclosures={data.disclosures} placement="top" />

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Guide outcomes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {data.learningOutcomes.map((outcome) => (
              <p key={outcome}>{outcome}</p>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-6">
            <article
              className="lesson-prose prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: data.bodyHtml }}
            />
          </CardContent>
        </Card>

        {data.screenshotPlaceholders?.length ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold">Screenshot placeholders</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                These placeholders mark the exact captures that still need to be
                collected and verified against the live trader-facing product.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {data.screenshotPlaceholders.map((placeholder) => (
                <ScreenshotPlaceholderCard
                  key={placeholder.placeholderId}
                  placeholder={placeholder}
                />
              ))}
            </div>
          </section>
        ) : null}

        <InlineLessonQuiz quizItems={data.quizItems} />

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Verified source anchors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {data.sources.map((source) => (
              <p key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {source.label}
                </a>
              </p>
            ))}
          </CardContent>
        </Card>

        <DisclosureStack disclosures={data.disclosures} placement="bottom" />
        <LessonPager
          previousLesson={data.previousLesson}
          nextLesson={data.nextLesson}
        />
      </div>
    </CourseLayout>
  );
}
