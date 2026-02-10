import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Building2, FileCheck2, MessageSquareLock, ShieldCheck, Sparkles } from "lucide-react";

type PartnerWizardGateEval = {
  reason: string | null;
};

type PartnerWizardState = {
  partnerName: string;
  onboardingStep: "PROFILE" | "IDENTITY" | "LEGAL" | "WAITING_APPROVAL" | "COMPLETED";
  inviteStatus: string;
  inviteExpiresAt: number | null;
  progressPct: number;
  agreementsSignedAt: number | null;
  approvedAt: number | null;
  profileData: {
    fundName: string | null;
    aumRange: string | null;
    institutionProfile?: {
      legalEntityName?: string | null;
      addresses?: unknown[];
      pointsOfContact?: unknown[];
    } | null;
  };
  gates: {
    viewDataRoom: boolean;
    runSimulations: boolean;
    requestAllocation: boolean;
    directContact: boolean;
  };
  gateEval: {
    runSimulations: PartnerWizardGateEval;
    requestAllocation: PartnerWizardGateEval;
    directContact: PartnerWizardGateEval;
  };
};

type WizardStep = {
  key: string;
  title: string;
  description: string;
  complete: boolean;
  active: boolean;
};

function fmtWhen(utcSec: number | null | undefined): string {
  if (!utcSec || !Number.isFinite(utcSec)) return "-";
  return new Date(utcSec * 1000).toLocaleString();
}

function buildWizardSteps(state: PartnerWizardState): WizardStep[] {
  const profileComplete = Boolean(state.profileData.fundName && state.profileData.aumRange);
  const identityComplete =
    state.onboardingStep === "LEGAL" ||
    state.onboardingStep === "WAITING_APPROVAL" ||
    state.onboardingStep === "COMPLETED";
  const legalComplete = Boolean(state.agreementsSignedAt) || state.onboardingStep === "WAITING_APPROVAL" || state.onboardingStep === "COMPLETED";
  const approvalComplete = Boolean(state.approvedAt) || state.onboardingStep === "COMPLETED";

  return [
    {
      key: "profile",
      title: "Profile Capture",
      description: "Fund and institutional identity details.",
      complete: profileComplete,
      active: state.onboardingStep === "PROFILE",
    },
    {
      key: "identity",
      title: "Identity Gate",
      description: "Simulation unlock checkpoint.",
      complete: identityComplete,
      active: state.onboardingStep === "IDENTITY",
    },
    {
      key: "legal",
      title: "Legal Package",
      description: "KYB + legal attestations.",
      complete: legalComplete,
      active: state.onboardingStep === "LEGAL",
    },
    {
      key: "approval",
      title: "Admin Approval",
      description: "Allocation/direct contact unlock.",
      complete: approvalComplete,
      active: state.onboardingStep === "WAITING_APPROVAL" || state.onboardingStep === "COMPLETED",
    },
  ];
}

export default function PartnerProfileWizard({
  state,
  onOpenComms,
  onScrollToProfile,
  onScrollToLegal,
}: {
  state: PartnerWizardState;
  onOpenComms: () => void;
  onScrollToProfile: () => void;
  onScrollToLegal: () => void;
}) {
  const steps = buildWizardSteps(state);
  const normalizedProgress = Math.max(0, Math.min(100, Number(state.progressPct || 0)));

  const lockedSignals = [
    !state.gates.runSimulations,
    !state.gates.requestAllocation,
    !state.gates.directContact,
  ];
  const isViewOnlyMode = lockedSignals.some(Boolean);
  const primaryLockReason =
    state.gateEval.requestAllocation.reason ||
    state.gateEval.runSimulations.reason ||
    state.gateEval.directContact.reason ||
    null;
  const stepIconByKey = {
    profile: Building2,
    identity: Sparkles,
    legal: FileCheck2,
    approval: ShieldCheck,
  } as const;

  return (
    <div className="space-y-3">
      {isViewOnlyMode ? (
        <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">VIEW-ONLY MODE</div>
              <div className="text-emerald-200/90">
                Complete onboarding steps to unlock simulations, allocations, and direct contact.
                {primaryLockReason ? ` (${primaryLockReason})` : ""}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-300/50 text-emerald-100 hover:bg-emerald-500/15"
                onClick={onScrollToProfile}
              >
                Continue Profile
              </Button>
              <Button
                size="sm"
                className="border border-emerald-300/40 bg-emerald-500/20 text-emerald-50 hover:bg-emerald-500/30"
                onClick={onOpenComms}
              >
                Inquire with Admin
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-neutral-700 bg-neutral-950/70 px-3 py-3 shadow-[0_0_0_1px_rgba(82,82,91,0.35)]">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-sky-100">{state.partnerName || "Partner"} onboarding wizard</div>
            <div className="text-xs text-neutral-300">
              Step: {state.onboardingStep} | invite: {state.inviteStatus || "-"} | progress: {normalizedProgress}%
            </div>
          </div>
          <div className="text-xs text-neutral-400">
            {state.inviteExpiresAt ? `Invite expires: ${fmtWhen(state.inviteExpiresAt)}` : "No invite expiry"}
          </div>
        </div>

        <div className="mt-3">
          <Progress value={normalizedProgress} className="h-2 bg-neutral-800 [&>div]:bg-cyan-400" />
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-4">
          {steps.map((step, index) => {
            const StepIcon = stepIconByKey[step.key as keyof typeof stepIconByKey] || Sparkles;
            return (
              <div
                key={step.key}
                className={cn(
                  "rounded border px-2 py-2 text-xs",
                  step.complete
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : step.active
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                      : "border-neutral-700 bg-neutral-800/70 text-neutral-300",
                )}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <StepIcon className="h-3.5 w-3.5" />
                  {index + 1}. {step.title}
                </div>
                <div className="mt-1 text-[11px]">{step.description}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="border-neutral-600 text-neutral-100" onClick={onScrollToProfile}>
            Edit Profile Step
          </Button>
          <Button size="sm" variant="outline" className="border-neutral-600 text-neutral-100" onClick={onScrollToLegal}>
            Open Legal Step
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-400/40 text-amber-100 hover:bg-amber-500/10"
            onClick={onOpenComms}
          >
            <MessageSquareLock className="mr-1 h-3.5 w-3.5" />
            Open Comms
          </Button>
        </div>
      </div>
    </div>
  );
}
