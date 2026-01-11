import { useState, useEffect, useMemo, useCallback } from "react";
import { AlertTriangle, Globe, CheckCircle, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";
import { useQuery } from "@tanstack/react-query";

type CountriesResp = { rows: Array<{ code: string; name: string }> };

type AvailabilityResp = {
  ok?: boolean;
  available?: boolean;
  enforce?: boolean;
  code?: string;
  reason?: string | null;
  countryCode?: string;
  termsExist?: boolean;
  signupAllowed?: boolean;
  restricted?: boolean;
  scopeKey?: string | null;
  fallbackUsed?: boolean;
  enforced?: boolean;
  message?: string;
  selected?: {
    globalTarget: { docSet: string; docType: string; jurisdictionType: string; jurisdictionKey: string };
    addendumTarget: { docSet: string; docType: string; jurisdictionType: string; jurisdictionKey: string };
  };
  modes?: { global: string; addendum: string };
  warnings?: string[];
};

interface SignupAvailabilityGateProps {
  onCountryChange: (country: string, available: boolean) => void;
  selectedCountry?: string;
}

export function SignupAvailabilityGate({ onCountryChange, selectedCountry }: SignupAvailabilityGateProps) {
  const [country, setCountry] = useState(selectedCountry || "");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AvailabilityResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: countriesData } = useQuery<CountriesResp>({
    queryKey: ["/api/meta/countries"],
  });

  const sortedCountries = useMemo(() => {
    const list = (countriesData?.rows || []).map((c) => ({
      code: String(c.code).toUpperCase(),
      name: c.name,
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [countriesData?.rows]);

  const countryIso2 = useMemo(() => String(country || "").trim().toUpperCase(), [country]);

  useEffect(() => {
    if (!countryIso2 || countryIso2.length !== 2) {
      setData(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithIdentity(`/api/legal/doc1/availability?country=${countryIso2}`);
        const j = (await res.json()) as AvailabilityResp;
        if (cancelled) return;

        setData(j);
        const isAvailable = Boolean(j.signupAllowed);
        onCountryChange(countryIso2, isAvailable);
      } catch (e: any) {
        if (cancelled) return;
        setError('Unable to verify jurisdiction. Please try again.');
        onCountryChange(countryIso2, false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [countryIso2, onCountryChange]);

  const handleCountryChange = (value: string) => {
    setCountry(value);
  };

  const available = Boolean(data?.signupAllowed);
  const restricted = Boolean(data?.restricted);
  const fallbackUsed = Boolean(data?.fallbackUsed);

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="country">Your Country</Label>
        <Select value={country} onValueChange={handleCountryChange}>
          <SelectTrigger id="country" className="w-full">
            <SelectValue placeholder="Select your country" />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            {sortedCountries.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Globe className="w-4 h-4 animate-spin" />
          <span>Checking jurisdiction...</span>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && !loading && (
        <>
          {restricted && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Jurisdiction Not Supported</AlertTitle>
              <AlertDescription>
                {data.message || "This jurisdiction is not supported due to regulatory restrictions."}
              </AlertDescription>
            </Alert>
          )}

          {!available && !restricted && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Terms Not Available</AlertTitle>
              <AlertDescription>
                {data.message || "Terms of service are not yet available for your jurisdiction. Please check back later."}
              </AlertDescription>
            </Alert>
          )}

          {available && fallbackUsed && (
            <Alert>
              <Globe className="h-4 w-4" />
              <AlertTitle>Using Global Terms</AlertTitle>
              <AlertDescription>
                {data.message || "Using global terms. Region-specific terms may be added later."}
              </AlertDescription>
            </Alert>
          )}

          {available && !fallbackUsed && !restricted && (
            <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
              <CheckCircle className="h-4 w-4 !text-green-600" />
              <AlertTitle className="text-green-800 dark:text-green-200">Jurisdiction Verified</AlertTitle>
              <AlertDescription className="text-green-700 dark:text-green-300">
                Terms of service are available for your location.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
