import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Disclosure } from "@/lib/educationTypes";

function toneIcon(tone: Disclosure["tone"]) {
  if (tone === "danger") return ShieldAlert;
  if (tone === "warning") return AlertTriangle;
  return Info;
}

function toneClassName(tone: Disclosure["tone"]) {
  if (tone === "danger") return "border-red-500/30 bg-red-500/10";
  if (tone === "warning") return "border-amber-500/30 bg-amber-500/10";
  return "border-blue-500/30 bg-blue-500/10";
}

type DisclosureStackProps = {
  disclosures: Disclosure[];
  placement: string;
};

export function DisclosureStack({ disclosures, placement }: DisclosureStackProps) {
  const visibleDisclosures = disclosures.filter((disclosure) =>
    disclosure.placements.includes(placement),
  );

  if (!visibleDisclosures.length) return null;

  return (
    <div className="space-y-3">
      {visibleDisclosures.map((disclosure) => {
        const Icon = toneIcon(disclosure.tone);
        return (
          <div
            key={`${placement}-${disclosure.id}`}
            className={cn(
              "rounded-2xl border p-4 text-sm text-muted-foreground",
              toneClassName(disclosure.tone),
            )}
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <div>
                <h3 className="font-semibold text-foreground">{disclosure.title}</h3>
                <p className="mt-1 leading-6">{disclosure.body}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
