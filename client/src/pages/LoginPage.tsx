import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { SignupAvailabilityGate } from "@/components/SignupAvailabilityGate";
import { TermsModal } from "@/components/TermsModal";
import { CaptchaTurnstile } from "@/components/CaptchaTurnstile";
import { SliderCaptcha } from "@/components/SliderCaptcha";
import { FileText, Loader2, Eye, EyeOff } from "lucide-react";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";
import { lazyWithPing } from "@/lib/lazyWithPing";

const LazyPhoneNumberInput = lazyWithPing(() =>
  import("@/components/PhoneNumberInput").then((m) => ({ default: m.PhoneNumberInput })),
);

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(25, "Password must be at most 25 characters"),
});

const registerSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(25, "Password must be at most 25 characters"),
  confirmPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(25, "Password must be at most 25 characters"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type LoginFormValues = z.infer<typeof loginSchema>;
type RegisterFormValues = z.infer<typeof registerSchema>;
type AuthTab = "login" | "register";

function normalizeAuthTab(raw: string | null | undefined): AuthTab {
  return raw === "register" ? "register" : "login";
}

function resolveAuthTabFromLocation(): AuthTab {
  if (typeof window === "undefined") return "login";
  const url = new URL(window.location.href);
  return normalizeAuthTab(url.searchParams.get("tab"));
}

type LegalDocResponse = {
  success: boolean;
  global?: { id: string; version: string; sha256: string };
  addendum?: { id: string; version: string; sha256: string; regionKey?: string | null };
  combinedSha256?: string;
  countryCode?: string;
  regionKey?: string | null;
  token?: string;
  text?: string;
  error?: string;
  warnings?: string[];
};

export default function LoginPage() {
  const [activeTab, setActiveTab] = useState<AuthTab>(() => resolveAuthTabFromLocation());
  const [signupCountry, setSignupCountry] = useState('');
  const [isCountryAvailable, setIsCountryAvailable] = useState(false);
  const { login, register } = useAuth();
  const { toast } = useToast();

  // Password visibility state - separate for each field for better security
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigator.userAgent || ""));
  });

  const [legal, setLegal] = useState<LegalDocResponse | null>(null);
  const [legalLoading, setLegalLoading] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const [publicCfg, setPublicCfg] = useState<{
    captcha?: { enforceSignupCaptcha: boolean; provider: string };
    signupPhoneEnforce?: boolean;
    signupsFrozen?: boolean;
    signupFreezeMessage?: string;
    waitlistEnabled?: boolean;
    waitlistPolicyVersion?: string;
    waitlistPolicySha256?: string;
  } | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [sliderCaptchaId, setSliderCaptchaId] = useState<string | null>(null);
  const [sliderVerified, setSliderVerified] = useState(false);
  const [sliderUiDone, setSliderUiDone] = useState(false);
  const [sliderKey, setSliderKey] = useState(0);
  const [sliderVerifying, setSliderVerifying] = useState(false);

  const [phone, setPhone] = useState("");
  const [phoneValid, setPhoneValid] = useState(false);

  const signupFrozen = Boolean(publicCfg?.signupsFrozen);
  const waitlistEnabled = Boolean(publicCfg?.waitlistEnabled);

  const [waitlistFullName, setWaitlistFullName] = useState("");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistPolicyOpen, setWaitlistPolicyOpen] = useState(false);
  const [waitlistPolicyScrolledToEnd, setWaitlistPolicyScrolledToEnd] = useState(false);
  const [waitlistAccepted, setWaitlistAccepted] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistPolicy, setWaitlistPolicy] = useState<{ version: string; sha256: string; content: string } | null>(null);

  const [waitlistPromptOpen, setWaitlistPromptOpen] = useState(false);
  const waitlistPromptShownRef = useRef(false);

  useEffect(() => {
    setAccepted(false);
    setScrolledToEnd(false);
    setLegal(null);
    setPhone("");
    setPhoneValid(false);
    setSliderVerified(false);
    setSliderUiDone(false);
    setSliderCaptchaId(null);
    setSliderKey((k) => k + 1);
  }, [signupCountry]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchWithIdentity("/api/auth/signup-config");
        const j = await r.json();
        setPublicCfg(j);
      } catch {
        setPublicCfg({ captcha: { enforceSignupCaptcha: false, provider: "TURNSTILE" }, signupPhoneEnforce: true });
      }
    })();
  }, []);

  useEffect(() => {
    if (activeTab !== "register") return;
    if (!signupFrozen) return;
    if (waitlistPromptShownRef.current) return;
    waitlistPromptShownRef.current = true;
    setWaitlistPromptOpen(true);
  }, [activeTab, signupFrozen]);

  useEffect(() => {
    async function loadTerms() {
      if (!signupCountry || signupCountry.length !== 2 || !isCountryAvailable) {
        setLegal(null);
        return;
      }
      setLegalLoading(true);
      try {
        const res = await fetchWithIdentity(`/api/legal/doc1/resolve?country=${encodeURIComponent(signupCountry)}`);
        const data: LegalDocResponse = await res.json();
        setLegal(data);
      } catch (e: any) {
        setLegal({ success: false, error: e?.message || "Failed to load terms." });
      } finally {
        setLegalLoading(false);
      }
    }
    loadTerms();
  }, [signupCountry, isCountryAvailable]);

  const enforceCaptcha = Boolean(publicCfg?.captcha?.enforceSignupCaptcha ?? false);
  const captchaProvider = String(publicCfg?.captcha?.provider ?? "TURNSTILE").toUpperCase();
  const phoneRequired = publicCfg?.signupPhoneEnforce ?? true;

  const loadWaitlistPolicy = useCallback(async () => {
    const r = await fetchWithIdentity("/api/auth/waitlist-policy");
    const j = await r.json().catch(() => ({} as any));
    if (!r.ok || !j?.ok) {
      throw new Error(j?.error || j?.message || "WAITLIST_POLICY_UNAVAILABLE");
    }
    const policy = {
      version: String(j.version ?? "1"),
      sha256: String(j.sha256 ?? ""),
      content: String(j.content ?? ""),
    };
    setWaitlistPolicy(policy);
    return policy;
  }, []);

  const handleCountryChange = useCallback((country: string, available: boolean) => {
    setSignupCountry(country);
    setIsCountryAvailable(available);
  }, []);

  const syncAuthTabUrl = useCallback((nextTab: AuthTab) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.pathname !== "/login") return;
    url.searchParams.set("tab", nextTab);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleAuthTabChange = useCallback((nextTab: string) => {
    const normalized = normalizeAuthTab(nextTab);
    setActiveTab(normalized);
    syncAuthTabUrl(normalized);
  }, [syncAuthTabUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromLocation = () => {
      setActiveTab(resolveAuthTabFromLocation());
    };
    window.addEventListener("popstate", syncFromLocation);
    syncFromLocation();
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const canSubmit = useMemo(() => {
    return (
      isCountryAvailable &&
      legal?.success &&
      legal?.token &&
      legal?.combinedSha256 &&
      accepted
    );
  }, [isCountryAvailable, legal, accepted]);

  const startSliderCaptcha = useCallback(async () => {
    try {
      setSliderVerifying(false);
      setSliderCaptchaId(null);
      setSliderVerified(false);
      setSliderUiDone(false);
      setSliderKey((k) => k + 1);

      const r = await fetchWithIdentity("/api/captcha/slider/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.message || "SLIDER_START_FAILED");
      }
      setSliderCaptchaId(String(j.captchaId));
    } catch (e: any) {
      setSliderCaptchaId(null);
      setSliderVerified(false);
      setSliderUiDone(false);
      toast({
        title: "Verification Unavailable",
        description: String(e?.message || "Unable to start verification"),
        variant: "destructive",
      });
    }
  }, [toast]);

  const completeSliderCaptcha = useCallback(async () => {
    if (!sliderCaptchaId) return;
    setSliderVerifying(true);
    try {
      const r = await fetchWithIdentity("/api/captcha/slider/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ captchaId: sliderCaptchaId }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.message || "CAPTCHA_FAILED");
      }
      setSliderVerified(true);
    } catch (e: any) {
      setSliderUiDone(false);
      setSliderVerified(false);
      setSliderCaptchaId(null);
      setSliderKey((k) => k + 1);
      toast({
        title: "Verification Failed",
        description: String(e?.message || "Please try again"),
        variant: "destructive",
      });
      try {
        await fetchWithIdentity("/api/captcha/slider/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      } catch {
        // ignore
      }
      startSliderCaptcha();
    } finally {
      setSliderVerifying(false);
    }
  }, [sliderCaptchaId, startSliderCaptcha, toast]);

  useEffect(() => {
    if (activeTab !== "register") {
      setSliderVerifying(false);
      setSliderVerified(false);
      setSliderUiDone(false);
      setSliderCaptchaId(null);
      setSliderKey((k) => k + 1);
      return;
    }
    if (!enforceCaptcha) return;
    if (captchaProvider !== "SLIDER") return;
    if (!sliderCaptchaId) {
      startSliderCaptcha();
    }
  }, [activeTab, enforceCaptcha, captchaProvider, sliderCaptchaId, startSliderCaptcha]);

  const captchaOk =
    !enforceCaptcha ||
    (captchaProvider === "SLIDER"
      ? sliderVerified
      : Boolean(captchaToken));

  const phoneSatisfied = phoneRequired ? phone && phoneValid : (!phone || phoneValid);
  const canRegister =
    canSubmit &&
    captchaOk &&
    phoneSatisfied &&
    !sliderVerifying;

  const onLoginSubmit = async (data: LoginFormValues) => {
    try {
      await login(data.email, data.password, { rememberMe });
    } catch (error) {
      toast({
        title: "Login Failed",
        description: "Invalid email or password",
        variant: "destructive",
      });
    }
  };

  const onRegisterSubmit = async (data: RegisterFormValues) => {
    if (!signupCountry) {
      toast({ title: "Select a country first", variant: "destructive" });
      return;
    }
    if (!legal?.token || !legal?.combinedSha256) {
      toast({ title: "Terms not loaded", variant: "destructive" });
      return;
    }
    if (!canSubmit || !legal?.success) {
      toast({
        title: "Terms Required",
        description: "Please read and accept the Terms & Conditions",
        variant: "destructive",
      });
      return;
    }

    const enforceCaptcha = Boolean(publicCfg?.captcha?.enforceSignupCaptcha ?? false);
    const provider = publicCfg?.captcha?.provider ?? "SLIDER";
    const captchaPassed = provider.toUpperCase() === "SLIDER" ? sliderVerified : Boolean(captchaToken);

    if (enforceCaptcha && !captchaPassed) {
      toast({
        title: "Complete Verification",
        description: "Couldn't verify you are human!",
        variant: "destructive"
      });
      return;
    }

    if (phoneRequired && (!phone || !phoneValid)) {
      toast({
        title: "Phone Required",
        description: "Please enter a valid phone number for the selected country.",
        variant: "destructive",
      });
      return;
    }

    if (!phoneRequired && phone && !phoneValid) {
      toast({
        title: "Invalid phone",
        description: "Please enter a valid phone number or leave it blank.",
        variant: "destructive",
      });
      return;
    }

    try {
      await register(data.email, data.username, data.password, {
        countryIso2: signupCountry,
        termsToken: legal.token,
        combinedSha256: legal.combinedSha256,
        captchaToken: enforceCaptcha && provider.toUpperCase() !== "SLIDER" ? captchaToken : null,
        phone: phoneValid ? phone : null,
      });
      toast({
        title: "Registration Successful",
        description: "Your account has been created",
      });
    } catch (error: any) {
      const message = error?.message || error?.data?.message || "Registration failed. Please try again.";
      toast({
        title: "Registration Failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  const submitWaitlist = useCallback(async () => {
    if (!signupFrozen) {
      toast({ title: "Signups are open", description: "You can register normally.", variant: "destructive" });
      return;
    }
    if (!waitlistEnabled) {
      toast({ title: "Waitlist disabled", description: "Invite requests are currently unavailable.", variant: "destructive" });
      return;
    }

    const fullName = waitlistFullName.trim();
    const email = waitlistEmail.trim();
    if (fullName.length < 2) {
      toast({ title: "Full name required", variant: "destructive" });
      return;
    }
    if (!z.string().email().safeParse(email).success) {
      toast({ title: "Valid email required", variant: "destructive" });
      return;
    }

    if (!waitlistAccepted) {
      toast({
        title: "Policy acceptance required",
        description: "Please review and accept the communications privacy notice.",
        variant: "destructive",
      });
      return;
    }

    const captchaOkNow =
      !enforceCaptcha ||
      (captchaProvider === "SLIDER" ? sliderVerified : Boolean(captchaToken));

    if (!captchaOkNow) {
      toast({ title: "Complete verification", description: "Please complete the CAPTCHA.", variant: "destructive" });
      return;
    }

    setWaitlistSubmitting(true);
    try {
      const policy = waitlistPolicy ?? (await loadWaitlistPolicy());
      const resp = await fetchWithIdentity("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          consent: true,
          captchaToken: enforceCaptcha && captchaProvider !== "SLIDER" ? captchaToken : null,
          policyVersion: policy.version,
          policySha256: policy.sha256,
        }),
      });
      const j = await resp.json().catch(() => ({} as any));
      if (!resp.ok || !j?.ok) {
        throw new Error(j?.error || j?.message || "WAITLIST_JOIN_FAILED");
      }

      toast({
        title: "Request received",
        description: j?.already ? "You're already on the invite list." : "We'll notify you when signups reopen.",
      });

      setWaitlistFullName("");
      setWaitlistEmail("");
      setWaitlistAccepted(false);
      setWaitlistPolicyScrolledToEnd(false);
      setWaitlistPolicyOpen(false);
      setCaptchaToken("");
      setCaptchaError(null);
    } catch (e: any) {
      toast({ title: "Could not submit", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setWaitlistSubmitting(false);
    }
  }, [
    signupFrozen,
    waitlistEnabled,
    waitlistFullName,
    waitlistEmail,
    waitlistAccepted,
    enforceCaptcha,
    captchaProvider,
    sliderVerified,
    captchaToken,
    waitlistPolicy,
    loadWaitlistPolicy,
    toast,
  ]);

  return (
    <div className="min-h-screen min-h-dvh flex items-center justify-center bg-background page-pad">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3v18h18" />
              <path d="m19 9-5-5-4 4-4 4" />
              <path d="m14 4 5 5" />
            </svg>
            <CardTitle className="text-2xl font-bold ml-2">TradeQuip</CardTitle>
          </div>
          <CardDescription>
            Enter your credentials to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" value={activeTab} onValueChange={handleAuthTabChange}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input placeholder="email@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showLoginPassword ? "text" : "password"}
                              placeholder="********"
                              autoComplete="current-password"
                              {...field}
                              onBlur={(e) => {
                                field.onBlur();
                                // Security: hide password when field loses focus
                                setShowLoginPassword(false);
                              }}
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
                              onClick={() => setShowLoginPassword(!showLoginPassword)}
                              aria-label={showLoginPassword ? "Hide password" : "Show password"}
                            >
                              {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="remember-me"
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(Boolean(checked))}
                    />
                    <label htmlFor="remember-me" className="text-sm text-muted-foreground select-none">
                      Stay logged in on this device
                    </label>
                  </div>
                  <Button type="submit" className="w-full">
                    Login
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="register">
              {signupFrozen ? (
                <div className="space-y-4">
                  <Dialog open={waitlistPromptOpen} onOpenChange={setWaitlistPromptOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Signups are temporarily paused</DialogTitle>
                        <DialogDescription>
                          {publicCfg?.signupFreezeMessage ?? "Signups are temporarily paused due to capacity. Existing users can still log in."}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="text-sm text-muted-foreground">
                        Would you like to be notified when signup slots reopen?
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setWaitlistPromptOpen(false)}>
                          No thanks
                        </Button>
                        <Button onClick={() => setWaitlistPromptOpen(false)}>
                          Request invite
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <div className="rounded-md border p-4">
                    <div className="text-base font-semibold">Signups paused</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {publicCfg?.signupFreezeMessage ?? "Signups are temporarily paused due to capacity. Existing users can still log in."}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Active users can still log in. New accounts are paused.
                    </div>
                  </div>

                  {waitlistEnabled ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Full name</label>
                        <Input
                          value={waitlistFullName}
                          onChange={(e) => setWaitlistFullName(e.target.value)}
                          placeholder="Your full name"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Email</label>
                        <Input
                          value={waitlistEmail}
                          onChange={(e) => setWaitlistEmail(e.target.value)}
                          placeholder="name@example.com"
                        />
                      </div>

                      {Boolean(publicCfg?.captcha?.enforceSignupCaptcha) && (
                        <div className="mt-3 space-y-2">
                          {publicCfg?.captcha?.provider === "TURNSTILE" ? (
                            <>
                              <CaptchaTurnstile
                                siteKey={(import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || ""}
                                onToken={(t) => {
                                  setCaptchaToken(t);
                                  setCaptchaError(null);
                                }}
                                onError={(m) => setCaptchaError(m)}
                              />
                              {captchaError && <div className="text-sm text-red-500">{captchaError}</div>}
                            </>
                          ) : (
                            <SliderCaptcha
                              key={sliderKey}
                              value={sliderUiDone}
                              disabled={sliderVerifying || !sliderCaptchaId}
                              onValueChange={(ok) => {
                                if (ok) {
                                  setSliderUiDone(true);
                                  completeSliderCaptcha();
                                } else {
                                  setSliderUiDone(false);
                                  setSliderVerified(false);
                                  startSliderCaptcha();
                                }
                              }}
                              label={sliderVerifying ? "Verifying..." : "Slide to verify you are human"}
                            />
                          )}
                        </div>
                      )}

                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="accept-waitlist-policy"
                          checked={waitlistAccepted}
                          onCheckedChange={(checked) => setWaitlistAccepted(checked === true)}
                          disabled={!waitlistPolicyScrolledToEnd}
                        />
                        <div className="text-sm leading-relaxed">
                          <label htmlFor="accept-waitlist-policy" className="cursor-pointer">
                            I agree to the communications & privacy notice
                          </label>{" "}
                          <Button
                            type="button"
                            variant="link"
                            className="p-0 h-auto align-baseline"
                            onClick={async () => {
                              try {
                                setWaitlistPolicyScrolledToEnd(false);
                                await loadWaitlistPolicy();
                                setWaitlistPolicyOpen(true);
                              } catch (e: any) {
                                toast({
                                  title: "Policy unavailable",
                                  description: String(e?.message || e),
                                  variant: "destructive",
                                });
                              }
                            }}
                          >
                            View notice
                          </Button>
                          {!waitlistPolicyScrolledToEnd && (
                            <div className="text-xs text-muted-foreground mt-1">
                              (Open the notice and scroll to the end to enable this checkbox)
                            </div>
                          )}
                        </div>
                      </div>

                      <Button
                        type="button"
                        className="w-full"
                        onClick={submitWaitlist}
                        disabled={waitlistSubmitting}
                      >
                        {waitlistSubmitting ? "Submitting..." : "Request invite"}
                      </Button>

                      <div className="text-xs text-muted-foreground">
                        We will email you when signup slots reopen.
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Invite requests are currently unavailable.
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <SignupAvailabilityGate
                    onCountryChange={handleCountryChange}
                    selectedCountry={signupCountry}
                  />

                  {signupCountry && isCountryAvailable && (
                    <Suspense
                      fallback={<div className="text-xs text-muted-foreground">Loading phone input…</div>}
                    >
                      <LazyPhoneNumberInput
                        countryIso2={signupCountry}
                        value={phone}
                        onChange={(e164, valid) => {
                          setPhone(e164);
                          setPhoneValid(valid);
                        }}
                        disabled={!signupCountry}
                        required={phoneRequired}
                      />
                    </Suspense>
                  )}

                  {phoneRequired && (
                    <div className="text-xs text-muted-foreground">
                      Phone number is required for signup.
                    </div>
                  )}

                  <Form {...registerForm}>
                    <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-4">
                      <FormField
                        control={registerForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input placeholder="email@example.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Username</FormLabel>
                            <FormControl>
                              <Input placeholder="johndoe" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  type={showRegisterPassword ? "text" : "password"}
                                  placeholder="********"
                                  autoComplete="new-password"
                                  {...field}
                                  onBlur={(e) => {
                                    field.onBlur();
                                    // Security: hide password when field loses focus
                                    setShowRegisterPassword(false);
                                  }}
                                />
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
                                  onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                                  aria-label={showRegisterPassword ? "Hide password" : "Show password"}
                                >
                                  {showRegisterPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="confirmPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Confirm Password</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  type={showConfirmPassword ? "text" : "password"}
                                  placeholder="********"
                                  autoComplete="new-password"
                                  {...field}
                                  onBlur={(e) => {
                                    field.onBlur();
                                    // Security: hide password when field loses focus
                                    setShowConfirmPassword(false);
                                  }}
                                />
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
                                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                                >
                                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="space-y-3 pt-2">
                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setTermsOpen(true)}
                            disabled={!signupCountry || legalLoading || !legal?.success}
                            className="flex items-center gap-2"
                          >
                            {legalLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                            {legalLoading ? "Loading Terms..." : "View Terms & Conditions"}
                          </Button>

                          <div className="text-xs text-muted-foreground">
                            {legal?.success ? (
                              <>
                                Loaded: <span className="font-medium">{legal.addendum?.id}</span> (v{legal.addendum?.version})
                              </>
                            ) : (
                              signupCountry && !legalLoading && (
                                <span className="text-destructive">{legal?.error || "Terms not loaded."}</span>
                              )
                            )}
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <Checkbox
                            id="accept-terms"
                            checked={accepted}
                            onCheckedChange={(checked) => setAccepted(checked === true)}
                            disabled={!legal?.success || !scrolledToEnd}
                          />
                          <label
                            htmlFor="accept-terms"
                            className="text-sm leading-relaxed cursor-pointer"
                          >
                            I accept the Terms & Conditions
                            {!scrolledToEnd && legal?.success && (
                              <span className="block text-xs text-muted-foreground mt-1">
                                (Please scroll to the end of the Terms modal to enable this checkbox)
                              </span>
                            )}
                          </label>
                        </div>
                      </div>

                      {Boolean(publicCfg?.captcha?.enforceSignupCaptcha) && (
                        <div className="mt-3 space-y-2">
                          {publicCfg?.captcha?.provider === "TURNSTILE" ? (
                            <>
                              <CaptchaTurnstile
                                siteKey={(import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || ""}
                                onToken={(t) => {
                                  setCaptchaToken(t);
                                  setCaptchaError(null);
                                }}
                                onError={(m) => setCaptchaError(m)}
                              />
                              {captchaError && <div className="text-sm text-red-500">{captchaError}</div>}
                            </>
                          ) : (
                            <SliderCaptcha
                              key={sliderKey}
                              value={sliderUiDone}
                              disabled={sliderVerifying || !sliderCaptchaId}
                              onValueChange={(ok) => {
                                if (ok) {
                                  setSliderUiDone(true);
                                  completeSliderCaptcha();
                                } else {
                                  setSliderUiDone(false);
                                  setSliderVerified(false);
                                  startSliderCaptcha();
                                }
                              }}
                              label={sliderVerifying ? "Verifying..." : "Slide to verify you are human"}
                            />
                          )}
                        </div>
                      )}

                      <Button type="submit" className="w-full" disabled={!canRegister}>
                        Register
                      </Button>
                    </form>
                  </Form>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-muted-foreground text-center">
            {activeTab === "login" ? (
              <p>
                Don't have an account?{" "}
                <Button variant="link" className="p-0" onClick={() => handleAuthTabChange("register")}>
                  Register
                </Button>
              </p>
            ) : (
              <p>
                Already have an account?{" "}
                <Button variant="link" className="p-0" onClick={() => handleAuthTabChange("login")}>
                  Login
                </Button>
              </p>
            )}
          </div>
        </CardFooter>
      </Card>

      <TermsModal
        open={termsOpen}
        onClose={() => setTermsOpen(false)}
        title="TradeQuip Terms & Conditions"
        text={legal?.success ? (legal.text || "") : ""}
        footerMeta={legal?.success ? `Document hash: ${legal.combinedSha256}` : ""}
        onScrolledToEnd={() => setScrolledToEnd(true)}
      />

      <TermsModal
        open={waitlistPolicyOpen}
        onClose={() => setWaitlistPolicyOpen(false)}
        title="Waitlist communications & privacy notice"
        text={waitlistPolicy?.content || ""}
        footerMeta={waitlistPolicy?.sha256 ? `Policy hash: ${waitlistPolicy.sha256}` : ""}
        onScrolledToEnd={() => setWaitlistPolicyScrolledToEnd(true)}
      />
    </div>
  );
}
