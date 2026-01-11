import { cn } from "@/lib/utils";
import { Crown, Star, Award } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import type { UserTier } from "@shared/schema";

interface PolicySnapshot {
  contenderCriteria?: {
    path1: {
      minAgeDays: number;
      minBalanceMultiplier: number;
      minTradesLifetime: number;
    };
    path2: {
      minAgeDays: number;
      minReturnPct: number;
      minTradesWindow: number;
      maxDaysSinceLastTrade: number;
    };
  };
}

interface TierBadgeProps {
  tier: UserTier;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

const sizeConfig = {
  sm: { iconSize: "h-3 w-3", padding: "px-2 py-0.5", text: "text-xs" },
  md: { iconSize: "h-4 w-4", padding: "px-3 py-1", text: "text-sm" },
  lg: { iconSize: "h-5 w-5", padding: "px-4 py-2", text: "text-base" },
};

export function TierBadge({ tier, size = "md", showLabel = true, className }: TierBadgeProps) {
  const tierConfig: Record<UserTier, {
    label: string;
    description: string;
    icon: typeof Crown;
    bgClass: string;
    textClass: string;
    borderClass: string;
    glowClass: string;
  }> = {
    CANDIDATE: {
      label: "Candidate",
      description: "Entry tier - prove your trading skills to advance",
      icon: Award,
      bgClass: "bg-slate-700",
      textClass: "text-slate-300",
      borderClass: "border-slate-500",
      glowClass: "",
    },
    PERFORMER: {
      label: "Performer",
      description: "Intermediate tier - consistent profitable trading demonstrated",
      icon: Star,
      bgClass: "bg-gradient-to-r from-amber-600 to-amber-500",
      textClass: "text-amber-100",
      borderClass: "border-amber-400",
      glowClass: "shadow-amber-500/30 shadow-lg",
    },
    SELECTED: {
      label: "Selected",
      description: "Elite tier - access to real capital and payouts",
      icon: Crown,
      bgClass: "bg-gradient-to-r from-purple-600 via-purple-500 to-indigo-500",
      textClass: "text-purple-100",
      borderClass: "border-purple-400",
      glowClass: "shadow-purple-500/40 shadow-lg animate-pulse",
    },
  };

  const config = tierConfig[tier];
  const sizeConf = sizeConfig[size];
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border font-medium",
              sizeConf.padding,
              sizeConf.text,
              config.bgClass,
              config.textClass,
              config.borderClass,
              config.glowClass,
              className
            )}
          >
            <Icon className={sizeConf.iconSize} />
            {showLabel && <span>{config.label}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="font-medium">{config.label} Tier</p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function TierProgressCard({ tier, className }: { tier: UserTier; className?: string }) {
  const { data: policySnapshot } = useQuery<PolicySnapshot>({
    queryKey: ["/api/policy/snapshot"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const nextTier = tier === "CANDIDATE" ? "PERFORMER" : tier === "PERFORMER" ? "SELECTED" : null;
  
  const path1 = policySnapshot?.contenderCriteria?.path1;
  const path2 = policySnapshot?.contenderCriteria?.path2;

  const path1MinAgeDays = path1?.minAgeDays ?? 30;
  const path1MinReturnPct = Math.round((path1?.minBalanceMultiplier ?? 1.2) * 100);
  const path1MinTrades = path1?.minTradesLifetime ?? 30;

  const path2MinAgeDays = path2?.minAgeDays ?? 90;
  const path2MinReturnPct = Math.round((path2?.minReturnPct ?? 0.1) * 100);
  const path2MinTrades = path2?.minTradesWindow ?? 20;
  
  return (
    <div className={cn("p-4 rounded-lg border bg-neutral-800 border-gray-700", className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-200">Your Trading Tier</h3>
        <TierBadge tier={tier} />
      </div>
      
      {nextTier && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Next tier:</span>
            <TierBadge tier={nextTier} size="sm" />
          </div>
          <div className="text-xs text-gray-500">
            {tier === "CANDIDATE" ? (
              <p>
                Requirements: {path1MinAgeDays}+ days active, {path1MinReturnPct}%+ return, {path1MinTrades}+ trades
              </p>
            ) : (
              <p>
                Requirements: {path2MinAgeDays}+ days active, {path2MinReturnPct}%+ return, {path2MinTrades}+ trades
              </p>
            )}
          </div>
        </div>
      )}
      
      {tier === "SELECTED" && (
        <div className="mt-2 p-2 bg-purple-900/30 border border-purple-600/50 rounded text-sm text-purple-200">
          You've reached the highest tier with access to real capital trading and payouts.
        </div>
      )}
    </div>
  );
}
