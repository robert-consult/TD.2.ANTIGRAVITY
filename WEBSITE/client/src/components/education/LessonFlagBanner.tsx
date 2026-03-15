import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function flagClassName(flag: string) {
  const normalized = flag.toLowerCase();
  if (normalized.includes("compliance") || normalized.includes("elevated risk")) {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }
  if (normalized.includes("crypto") || normalized.includes("screenshots pending")) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  }
  if (normalized.includes("platform guide") || normalized.includes("core curriculum")) {
    return "border-blue-500/30 bg-blue-500/10 text-blue-100";
  }
  if (normalized.includes("optional extension")) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  }
  return "border-border bg-background text-foreground";
}

type LessonFlagBannerProps = {
  flags: string[];
};

export function LessonFlagBanner({ flags }: LessonFlagBannerProps) {
  if (!flags.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {flags.map((flag) => (
        <Badge
          key={flag}
          variant="outline"
          className={cn("rounded-full px-3 py-1 text-[11px]", flagClassName(flag))}
        >
          {flag}
        </Badge>
      ))}
    </div>
  );
}
