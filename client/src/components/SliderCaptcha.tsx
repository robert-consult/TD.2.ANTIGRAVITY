import { useEffect, useMemo, useState, useRef } from "react";
import { Check, ChevronsRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SliderCaptchaProps = {
  value?: boolean;
  onValueChange?: (ok: boolean) => void;
  disabled?: boolean;
  label?: string;
};

function getProgressColor(pct: number): string {
  if (pct >= 100) return "rgb(74, 222, 128)";
  if (pct >= 66) return "rgb(234, 179, 8)";
  if (pct >= 33) return "rgb(234, 88, 12)";
  return "rgb(185, 28, 28)";
}

function getTrackFillColor(pct: number): string {
  if (pct >= 100) return "rgb(22, 101, 52)";
  if (pct >= 66) return "rgba(234, 179, 8, 0.2)";
  if (pct >= 33) return "rgba(234, 88, 12, 0.2)";
  return "rgba(185, 28, 28, 0.15)";
}

export function SliderCaptcha({
  value,
  onValueChange,
  disabled,
  label = "Slide to verify",
}: SliderCaptchaProps) {
  const [pct, setPct] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const verified = Boolean(value);

  useEffect(() => {
    if (verified) {
      setPct(100);
    } else {
      setPct(0);
    }
  }, [verified]);

  const text = useMemo(() => {
    if (verified) return "Verified";
    if (pct >= 90) return "Release to verify";
    return label;
  }, [label, pct, verified]);

  const iconColor = verified ? "rgb(74, 222, 128)" : getProgressColor(pct);
  const fillColor = getTrackFillColor(pct);

  const handleMove = (clientX: number) => {
    if (!trackRef.current || disabled || verified) return;
    const rect = trackRef.current.getBoundingClientRect();
    const thumbSize = 40;
    const trackWidth = rect.width - thumbSize;
    const x = clientX - rect.left - thumbSize / 2;
    const newPct = Math.max(0, Math.min(100, (x / trackWidth) * 100));
    setPct(Math.round(newPct));
  };

  const handleEnd = () => {
    setIsDragging(false);
    if (pct >= 100) {
      onValueChange?.(true);
    } else {
      setPct(0);
      onValueChange?.(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled || verified) return;
    e.preventDefault();
    setIsDragging(true);
    handleMove(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled || verified) return;
    setIsDragging(true);
    handleMove(e.touches[0].clientX);
  };

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX);
    const onEnd = () => handleEnd();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onEnd);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [isDragging, pct, disabled, verified]);

  return (
    <div className={cn("rounded-lg border p-3 w-full", disabled ? "opacity-60" : "")}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={cn("text-sm", verified ? "text-green-600 dark:text-green-400 font-medium" : "text-muted-foreground")}>
          {text}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={disabled || (!verified && pct === 0)}
          onClick={() => {
            setPct(0);
            onValueChange?.(false);
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="ml-1.5 text-xs">Reset</span>
        </Button>
      </div>

      <div
        ref={trackRef}
        className={cn(
          "relative h-12 rounded-full border-2 overflow-hidden select-none border-[#0ea5e9]",
          disabled || verified ? "cursor-default" : "cursor-pointer"
        )}
        style={{ backgroundColor: fillColor }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-75"
          style={{
            width: `${pct}%`,
            backgroundColor: fillColor,
          }}
        />

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={cn(
            "text-sm font-medium transition-colors",
            verified ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
          )}>
            {pct}%
          </span>
        </div>

        <div
          className="absolute top-1 h-10 w-10 rounded-full flex items-center justify-center shadow-md transition-all duration-75"
          style={{
            left: `calc(4px + (100% - 48px) * ${pct / 100})`,
            backgroundColor: iconColor,
          }}
        >
          {verified ? (
            <Check className="h-5 w-5 text-white" strokeWidth={3} />
          ) : (
            <ChevronsRight className="h-5 w-5 text-white" strokeWidth={2.5} />
          )}
        </div>
      </div>
    </div>
  );
}
