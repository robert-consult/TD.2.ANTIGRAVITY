import React, { useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { X, ShieldAlert, RefreshCcw } from "lucide-react";

type CountriesResp = { rows: Array<{ code: string; name: string }> };

type SystemConfigLike = {
  jurisdictionRestrictedIso2Csv: string;
  jurisdictionRestrictedMessage: string;
  jurisdictionEnforceByIpGeo: boolean;
  jurisdictionEnforceBySignupCountry: boolean;
  jurisdictionBlockSignup: boolean;
  jurisdictionBlockLogin: boolean;
};

function normalizeIso2List(raw: string): string[] {
  const toks = String(raw || "")
    .split(/[,\s]+/g)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const t of toks) {
    if (!/^[A-Z]{2}$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function toCsv(list: string[]): string {
  return list.join(",");
}

const JURISDICTION_FIELD_HELP = {
  restrictedIso2Csv: {
    inline: "Canonical CSV list of restricted ISO2 country codes used by enforcement rules.",
    tooltip:
      "Maintain uppercase 2-letter ISO codes only. This list is the source of truth for signup/login blocking decisions.",
  },
  addIso2: {
    inline: "Quick add one ISO2 code to the restricted list.",
    tooltip:
      "Use when adding one country at a time to avoid editing CSV manually. Input must be a valid 2-letter ISO code.",
  },
  jurisdictionRestrictedMessage: {
    inline: "Message shown to users blocked by jurisdiction policy.",
    tooltip:
      "Keep wording compliance-safe and neutral. Do not expose internal rule logic or sensitive legal strategy details.",
  },
  jurisdictionEnforceBySignupCountry: {
    inline: "Apply restrictions using the country selected during signup.",
    tooltip:
      "Reliable against VPN masking but depends on accurate signup-country capture and policy alignment.",
  },
  jurisdictionEnforceByIpGeo: {
    inline: "Apply restrictions using resolved Geo-IP country.",
    tooltip:
      "Can block sessions immediately, but VPN/proxy routing may create false positives/negatives.",
  },
  jurisdictionBlockSignup: {
    inline: "Prevent new registrations when jurisdiction policy matches.",
    tooltip:
      "Use to stop onboarding from restricted regions while preserving existing account data and audit trails.",
  },
  jurisdictionBlockLogin: {
    inline: "Prevent logins when jurisdiction policy matches.",
    tooltip:
      "Use when policy requires active session denial from restricted regions, not just signup prevention.",
  },
} as const;

function JurisdictionHintTitle({
  label,
  hint,
  className = "text-sm font-medium",
}: {
  label: string;
  hint: string;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className={className}>{label}</div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
            aria-label={`${label} hint`}
          >
            Hint
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
          {hint}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function JurisdictionControlsCard(props: {
  config: SystemConfigLike;
  setConfig: React.Dispatch<React.SetStateAction<any>>;
  setConfigChanged: (v: boolean) => void;
  configChanged: boolean;
  onSave: () => void;
  saving: boolean;
}) {
  const { toast } = useToast();

  const { data: countriesData } = useQuery<CountriesResp>({
    queryKey: ["/api/meta/countries"],
  });

  const countryNameByIso2 = useMemo(() => {
    const map = new Map<string, string>();
    (countriesData?.rows || []).forEach((c) => map.set(String(c.code).toUpperCase(), c.name));
    return map;
  }, [countriesData?.rows]);

  const restrictedList = useMemo(
    () => normalizeIso2List(props.config.jurisdictionRestrictedIso2Csv),
    [props.config.jurisdictionRestrictedIso2Csv]
  );

  const [addIso2, setAddIso2] = useState("");

  const setField = useCallback(
    (patch: Partial<SystemConfigLike>) => {
      props.setConfig((prev: any) => (prev ? { ...prev, ...patch } : prev));
      props.setConfigChanged(true);
    },
    [props]
  );

  const removeIso2 = useCallback(
    (iso2: string) => {
      const next = restrictedList.filter((x) => x !== iso2);
      setField({ jurisdictionRestrictedIso2Csv: toCsv(next) });
    },
    [restrictedList, setField]
  );

  const addCountry = useCallback(() => {
    const iso2 = String(addIso2 || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso2)) {
      toast({ title: "Invalid ISO2", description: "Use a 2-letter ISO code (e.g., IR, KP).", variant: "destructive" });
      return;
    }
    const next = Array.from(new Set([...restrictedList, iso2]));
    setField({ jurisdictionRestrictedIso2Csv: toCsv(next) });
    setAddIso2("");
  }, [addIso2, restrictedList, setField, toast]);

  const revokeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/system-config/jurisdiction-enforcement/revoke-active");
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Enforcement applied",
        description: `Scanned ${data?.scanned ?? "?"} sessions, revoked ${data?.revoked ?? 0}.`,
      });
    },
    onError: (e: any) => {
      toast({
        title: "Enforcement failed",
        description: String(e?.message || e),
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Jurisdiction Controls (Sanctions / Restricted Countries)
        </CardTitle>
        <CardDescription>
          Block signups and/or logins for specific jurisdictions. Enforcement can be based on IP geolocation, signup-selected country, or both.
          VPNs can affect IP-based enforcement.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <TooltipProvider delayDuration={120}>
        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
          Jurisdiction controls include hidden <span className="font-medium">Hint</span> explainers for enforcement scope, rollout risks, and policy behavior.
        </div>
        <div className="space-y-2">
          <JurisdictionHintTitle
            label="Restricted Countries (ISO2)"
            hint={JURISDICTION_FIELD_HELP.restrictedIso2Csv.tooltip}
          />
          <div className="text-xs text-muted-foreground">{JURISDICTION_FIELD_HELP.restrictedIso2Csv.inline}</div>

          <div className="flex gap-2">
            <Input
              value={props.config.jurisdictionRestrictedIso2Csv}
              onChange={(e) => setField({ jurisdictionRestrictedIso2Csv: e.target.value })}
              placeholder="e.g., KP,IR,CU,SY"
              title={JURISDICTION_FIELD_HELP.restrictedIso2Csv.tooltip}
            />
          </div>

          <div className="flex gap-2">
            <Input
              value={addIso2}
              onChange={(e) => setAddIso2(e.target.value)}
              placeholder="Add ISO2 (e.g., IR)"
              className="max-w-[220px]"
              title={JURISDICTION_FIELD_HELP.addIso2.tooltip}
            />
            <Button type="button" onClick={addCountry} variant="secondary">
              Add
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                  aria-label="Add ISO2 hint"
                >
                  Hint
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                {JURISDICTION_FIELD_HELP.addIso2.tooltip}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="text-xs text-muted-foreground">{JURISDICTION_FIELD_HELP.addIso2.inline}</div>

          <div className="flex flex-wrap gap-2 pt-2">
            {restrictedList.length === 0 ? (
              <div className="text-sm text-muted-foreground">No restricted countries configured.</div>
            ) : (
              restrictedList.map((iso2) => (
                <Badge key={iso2} variant="outline" className="flex items-center gap-2">
                  <span>
                    {iso2}
                    {countryNameByIso2.get(iso2) ? ` — ${countryNameByIso2.get(iso2)}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeIso2(iso2)}
                    className="rounded hover:bg-muted p-0.5"
                    aria-label={`Remove ${iso2}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <JurisdictionHintTitle
            label="Block Message"
            hint={JURISDICTION_FIELD_HELP.jurisdictionRestrictedMessage.tooltip}
          />
          <div className="text-xs text-muted-foreground">{JURISDICTION_FIELD_HELP.jurisdictionRestrictedMessage.inline}</div>
          <Textarea
            value={props.config.jurisdictionRestrictedMessage}
            onChange={(e) => setField({ jurisdictionRestrictedMessage: e.target.value })}
            placeholder="Message shown to users who are blocked."
            title={JURISDICTION_FIELD_HELP.jurisdictionRestrictedMessage.tooltip}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={props.config.jurisdictionEnforceBySignupCountry}
              onCheckedChange={(v) => setField({ jurisdictionEnforceBySignupCountry: Boolean(v) })}
            />
            <span className="text-sm w-full">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">Enforce by signup-selected country</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                      aria-label="Enforce by signup-selected country hint"
                    >
                      Hint
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                    {JURISDICTION_FIELD_HELP.jurisdictionEnforceBySignupCountry.tooltip}
                  </TooltipContent>
                </Tooltip>
              </span>
              <div className="text-muted-foreground">
                {JURISDICTION_FIELD_HELP.jurisdictionEnforceBySignupCountry.inline}
              </div>
            </span>
          </label>

          <label className="flex items-start gap-2">
            <Checkbox
              checked={props.config.jurisdictionEnforceByIpGeo}
              onCheckedChange={(v) => setField({ jurisdictionEnforceByIpGeo: Boolean(v) })}
            />
            <span className="text-sm w-full">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">Enforce by IP geolocation</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                      aria-label="Enforce by IP geolocation hint"
                    >
                      Hint
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                    {JURISDICTION_FIELD_HELP.jurisdictionEnforceByIpGeo.tooltip}
                  </TooltipContent>
                </Tooltip>
              </span>
              <div className="text-muted-foreground">
                {JURISDICTION_FIELD_HELP.jurisdictionEnforceByIpGeo.inline}
              </div>
            </span>
          </label>

          <label className="flex items-start gap-2">
            <Checkbox
              checked={props.config.jurisdictionBlockSignup}
              onCheckedChange={(v) => setField({ jurisdictionBlockSignup: Boolean(v) })}
            />
            <span className="text-sm w-full">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">Block signups</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                      aria-label="Block signups hint"
                    >
                      Hint
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                    {JURISDICTION_FIELD_HELP.jurisdictionBlockSignup.tooltip}
                  </TooltipContent>
                </Tooltip>
              </span>
              <div className="text-muted-foreground">{JURISDICTION_FIELD_HELP.jurisdictionBlockSignup.inline}</div>
            </span>
          </label>

          <label className="flex items-start gap-2">
            <Checkbox
              checked={props.config.jurisdictionBlockLogin}
              onCheckedChange={(v) => setField({ jurisdictionBlockLogin: Boolean(v) })}
            />
            <span className="text-sm w-full">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">Block logins</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                      aria-label="Block logins hint"
                    >
                      Hint
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                    {JURISDICTION_FIELD_HELP.jurisdictionBlockLogin.tooltip}
                  </TooltipContent>
                </Tooltip>
              </span>
              <div className="text-muted-foreground">{JURISDICTION_FIELD_HELP.jurisdictionBlockLogin.inline}</div>
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={props.onSave} disabled={!props.configChanged || props.saving}>
            Save Changes
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => revokeMutation.mutate()}
            disabled={props.configChanged || revokeMutation.isPending}
            title={props.configChanged ? "Save changes first" : "Revoke active sessions that now violate this policy"}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Revoke Active Sessions Now
          </Button>
        </div>

        {props.configChanged && (
          <div className="text-sm text-muted-foreground">
            Save changes before applying enforcement to active sessions.
          </div>
        )}
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
