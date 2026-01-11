import React, { useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
        <div className="space-y-2">
          <div className="text-sm font-medium">Restricted Countries (ISO2)</div>

          <div className="flex gap-2">
            <Input
              value={props.config.jurisdictionRestrictedIso2Csv}
              onChange={(e) => setField({ jurisdictionRestrictedIso2Csv: e.target.value })}
              placeholder="e.g., KP,IR,CU,SY"
            />
          </div>

          <div className="flex gap-2">
            <Input
              value={addIso2}
              onChange={(e) => setAddIso2(e.target.value)}
              placeholder="Add ISO2 (e.g., IR)"
              className="max-w-[220px]"
            />
            <Button type="button" onClick={addCountry} variant="secondary">
              Add
            </Button>
          </div>

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
          <div className="text-sm font-medium">Block Message</div>
          <Textarea
            value={props.config.jurisdictionRestrictedMessage}
            onChange={(e) => setField({ jurisdictionRestrictedMessage: e.target.value })}
            placeholder="Message shown to users who are blocked."
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={props.config.jurisdictionEnforceBySignupCountry}
              onCheckedChange={(v) => setField({ jurisdictionEnforceBySignupCountry: Boolean(v) })}
            />
            <span className="text-sm">
              <span className="font-medium">Enforce by signup-selected country</span>
              <div className="text-muted-foreground">
                Uses the country the user selects during signup (stored on the user profile).
              </div>
            </span>
          </label>

          <label className="flex items-start gap-2">
            <Checkbox
              checked={props.config.jurisdictionEnforceByIpGeo}
              onCheckedChange={(v) => setField({ jurisdictionEnforceByIpGeo: Boolean(v) })}
            />
            <span className="text-sm">
              <span className="font-medium">Enforce by IP geolocation</span>
              <div className="text-muted-foreground">
                Uses Geo-IP country. VPN/proxy can bypass or distort this.
              </div>
            </span>
          </label>

          <label className="flex items-start gap-2">
            <Checkbox
              checked={props.config.jurisdictionBlockSignup}
              onCheckedChange={(v) => setField({ jurisdictionBlockSignup: Boolean(v) })}
            />
            <span className="text-sm">
              <span className="font-medium">Block signups</span>
              <div className="text-muted-foreground">Prevents registration when policy matches.</div>
            </span>
          </label>

          <label className="flex items-start gap-2">
            <Checkbox
              checked={props.config.jurisdictionBlockLogin}
              onCheckedChange={(v) => setField({ jurisdictionBlockLogin: Boolean(v) })}
            />
            <span className="text-sm">
              <span className="font-medium">Block logins</span>
              <div className="text-muted-foreground">Prevents login when policy matches.</div>
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
      </CardContent>
    </Card>
  );
}

