import { CameraOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LessonPayload } from "@/lib/educationTypes";

type ScreenshotPlaceholderCardProps = {
  placeholder: NonNullable<LessonPayload["screenshotPlaceholders"]>[number];
};

export function ScreenshotPlaceholderCard({
  placeholder,
}: ScreenshotPlaceholderCardProps) {
  return (
    <Card className="screenshot-placeholder-card border-amber-500/30 bg-amber-500/10">
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-amber-100">
          <CameraOff className="h-4 w-4" />
          {placeholder.status}
        </div>
        <CardTitle className="text-lg text-foreground">{placeholder.surface}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>Device: {placeholder.device}</p>
        <div>
          <p className="font-semibold text-foreground">Expected labels</p>
          <p className="mt-1">{placeholder.expectedLabels.join(", ")}</p>
        </div>
        <div>
          <p className="font-semibold text-foreground">Source-of-truth path</p>
          <p className="mt-1 break-all">{placeholder.sourcePath}</p>
        </div>
        <div>
          <p className="font-semibold text-foreground">Placeholder alt text</p>
          <p className="mt-1">{placeholder.altText}</p>
        </div>
      </CardContent>
    </Card>
  );
}
