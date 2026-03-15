import { Badge } from "@/components/ui/badge";
import type { LessonPayload } from "@/lib/educationTypes";

type LessonMetaBarProps = {
  freshness: LessonPayload["freshness"];
  quizCount: number;
};

export function LessonMetaBar({ freshness, quizCount }: LessonMetaBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="outline" className="border-border bg-background">
        {quizCount} quiz {quizCount === 1 ? "item" : "items"}
      </Badge>
      {freshness?.classification ? (
        <Badge variant="outline" className="border-border bg-background">
          {freshness.classification}
        </Badge>
      ) : null}
      {freshness?.lastVerifiedOn ? (
        <span>Verified {freshness.lastVerifiedOn}</span>
      ) : null}
      {freshness?.nextReviewOn ? (
        <span>Review by {freshness.nextReviewOn}</span>
      ) : null}
    </div>
  );
}
