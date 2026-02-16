import { cn } from "@/lib/utils";

type StaleDataBadgeProps = {
  className?: string;
  label?: string;
};

export function StaleDataBadge({ className, label = "Updating..." }: StaleDataBadgeProps) {
  return (
    <span
      className={cn(
        "tq-stale-indicator inline-flex items-center gap-1 text-[0.68rem] font-medium text-cyan-300/90",
        className,
      )}
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />
      <span>{label}</span>
    </span>
  );
}
