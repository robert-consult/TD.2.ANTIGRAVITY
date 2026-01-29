import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Header } from "@/components/Header";
import { User, Mail, Phone, Key, Shield, Smartphone, Bell, Settings, Monitor, Clock, Globe, Languages, MapPin, LogOut, X, QrCode, CheckCircle, AlertTriangle, Copy, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { TierBadge, TierProgressCard } from "@/components/TierBadge";
import { VerificationSection } from "@/components/VerificationCards";
import type { UserTier } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PhoneNumberInput } from "@/components/PhoneNumberInput";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";
import { useI18n } from "@/i18n";

export default function ProfileSettings() {
  const { user, checkAuth, updateUser, logout } = useAuth();
  const { toast } = useToast();
  const { locale, setLocale, supportedLocales } = useI18n();

  const [formData, setFormData] = useState({
    username: "",
    name: "",
    phone: "",
  });
  const [formInitialized, setFormInitialized] = useState(false);

  const [phoneValid, setPhoneValid] = useState(false);

  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [showPasswords, setShowPasswords] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
    accountPassword: false,
  });

  const [accountAction, setAccountAction] = useState<"deactivate" | "delete" | null>(null);
  const [accountReasonCode, setAccountReasonCode] = useState("TAKING_BREAK");
  const [accountReasonText, setAccountReasonText] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountConfirm, setAccountConfirm] = useState("");

  const [notifications, setNotifications] = useState({
    tradeExecuted: true,
    marginWarning: true,
    stopLossHit: true,
    dailySummary: false,
    promotions: false,
  });

  const [preferences, setPreferences] = useState({
    timezone: "UTC",
    language: "en",
    country: "",
  });

  const [preferencePolicy, setPreferencePolicy] = useState({
    timezoneEditable: true,
    countryLocked: false,
  });

  const [preferencesInitialized, setPreferencesInitialized] = useState(false);
  const previousLanguageRef = useRef<string | null>(null);
  const previousLocaleRef = useRef<string | null>(null);

  const [mfaSetupDialog, setMfaSetupDialog] = useState(false);
  const [mfaDisableDialog, setMfaDisableDialog] = useState(false);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[] | null>(null);
  const [mfaDisableCode, setMfaDisableCode] = useState("");

  const { data: mfaStatus, refetch: refetchMfaStatus } = useQuery<{
    enabled: boolean;
    enabledAt: string | null;
    hasRecoveryCodes: boolean;
    hasPendingSetup?: boolean;
  }>({
    queryKey: ["/api/profile/mfa/status"],
    enabled: !!user,
  });

  const { data: timezonesData } = useQuery<{
    generatedAt: number;
    rows: Array<{
      name: string;
      label: string;
      countryCode: string;
      countryName: string;
      alternativeName: string;
      mainCities: string[];
      rawOffsetInMinutes: number;
      currentOffsetMinutes: number;
      abbreviation: string;
      rawFormat: string;
    }>;
  }>({
    queryKey: ["/api/meta/timezones"],
  });

  const { data: countriesData } = useQuery<{
    rows: Array<{ code: string; name: string }>;
  }>({
    queryKey: ["/api/meta/countries"],
  });

  const { data: languagesData } = useQuery<{
    rows: Array<{ code: string; name: string; nativeName: string; rtl?: boolean }>;
  }>({
    queryKey: ["/api/meta/languages"],
  });

  const accountReasonOptions = [
    { value: "TAKING_BREAK", label: "Taking a break" },
    { value: "RISK_MANAGEMENT", label: "Risk management concerns" },
    { value: "POOR_PERFORMANCE", label: "Performance not meeting goals" },
    { value: "SWITCHING_PLATFORM", label: "Switching platforms" },
    { value: "SUPPORT_ISSUES", label: "Support or product issues" },
    { value: "OTHER", label: "Other" },
  ];
  const accountActionLabel = accountAction === "delete" ? "Delete" : "Deactivate";
  const accountConfirmToken = accountAction === "delete" ? "DELETE" : "DEACTIVATE";

  const supportedLocaleSet = useMemo(() => {
    return new Set(supportedLocales.map((locale) => locale.toLowerCase()));
  }, [supportedLocales.join(",")]);

  const languageOptions = useMemo(() => {
    const rows = languagesData?.rows ?? [];
    if (!supportedLocales.length) return rows;
    return rows.filter((lang) => supportedLocaleSet.has(lang.code.toLowerCase()));
  }, [languagesData?.rows, supportedLocales.join(",")]);

  const normalizeLanguage = (value?: string) => {
    const fallback = supportedLocales[0] || "en";
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    const exact = supportedLocales.find((locale) => locale.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const base = raw.split("-")[0].toLowerCase();
    const baseMatch = supportedLocales.find((locale) => locale.toLowerCase() === base);
    return baseMatch ?? fallback;
  };

  const formatDateTime = (
    value: unknown,
    options?: Intl.DateTimeFormatOptions,
    fallback = "N/A",
  ) => {
    if (value === null || value === undefined) return fallback;
    const toLocale = (d: Date) => d.toLocaleString(locale || "en", options);
    const coerceNumber = (n: number) => {
      const ms = n < 1e12 ? n * 1000 : n;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    if (typeof value === "number" && Number.isFinite(value)) {
      if (value <= 0) return fallback;
      const d = coerceNumber(value);
      return d ? toLocale(d) : fallback;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return fallback;
      if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!Number.isFinite(num) || num <= 0) return fallback;
        const d = Number.isFinite(num) ? coerceNumber(num) : null;
        return d ? toLocale(d) : fallback;
      }
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? fallback : toLocale(d);
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? fallback : toLocale(value);
    }

    const d = new Date(value as any);
    return Number.isNaN(d.getTime()) ? fallback : toLocale(d);
  };

  const prefetchI18nBundle = async (nextLocale: string) => {
    const normalized = normalizeLanguage(nextLocale);
    return queryClient.fetchQuery({
      queryKey: ["i18nBundle", normalized],
      queryFn: async () => {
        const res = await fetch(`/api/i18n/bundle?locale=${encodeURIComponent(normalized)}`);
        if (res.status === 304) {
          const cached = queryClient.getQueryData(["i18nBundle", normalized]);
          if (cached) return cached;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Failed to load i18n bundle (${res.status}): ${body}`);
        }
        const data = (await res.json()) as any;
        return {
          locale: String(data?.locale || normalized),
          strings: (data?.strings && typeof data.strings === "object") ? data.strings : {},
          etag: res.headers.get("ETag") ?? undefined,
        };
      },
      staleTime: 5 * 60_000,
    });
  };

  const handleLanguageChange = async (value: string) => {
    const normalized = normalizeLanguage(value);
    previousLanguageRef.current = preferences.language;
    previousLocaleRef.current = locale;
    setPreferences((prev) => ({ ...prev, language: normalized }));

    try {
      await prefetchI18nBundle(normalized);
    } catch (error) {
      console.warn("[i18n] Prefetch failed:", error);
    }

    setLocale(normalized);
    updateUser({ language: normalized });
    languageMutation.mutate(normalized);
  };

  const mfaSetupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithIdentity("/api/profile/mfa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to start MFA setup");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setMfaQrCode(data.qrCodeDataUrl);
      setMfaSetupDialog(true);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const mfaEnableMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await fetchWithIdentity("/api/profile/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to enable MFA");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.recoveryCodes) {
        setMfaRecoveryCodes(data.recoveryCodes);
        setMfaQrCode(null);
        setMfaVerifyCode("");
      }
      refetchMfaStatus();
      toast({ title: "2FA Enabled", description: "Your account is now protected with two-factor authentication" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const mfaDisableMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await fetchWithIdentity("/api/profile/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to disable MFA");
      }
      return response.json();
    },
    onSuccess: () => {
      setMfaDisableDialog(false);
      setMfaDisableCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/profile/mfa/status"] });
      refetchMfaStatus();
      toast({ title: "2FA Disabled", description: "Two-factor authentication has been disabled" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleMfaEnable = () => {
    mfaEnableMutation.mutate(mfaVerifyCode);
  };

  const closeMfaSetupDialog = () => {
    setMfaSetupDialog(false);
    setMfaQrCode(null);
    setMfaVerifyCode("");
    setMfaRecoveryCodes(null);
  };

  const copyRecoveryCodes = () => {
    if (mfaRecoveryCodes) {
      navigator.clipboard.writeText(mfaRecoveryCodes.join("\n"));
      toast({ title: "Copied", description: "Recovery codes copied to clipboard" });
    }
  };

  // Fetch login history
  const { data: loginHistory } = useQuery({
    queryKey: ["/api/profile/login-history"],
    enabled: !!user,
  });

  // Fetch active sessions using the new /api/me/sessions endpoint
  const { data: sessionsResponse, refetch: refetchSessions } = useQuery<{
    currentSessionId: string;
    rows: Array<{
      id: string;
      createdAt: number;
      lastSeenAt: number;
      ip: string;
      userAgent: string;
      deviceType: string;
      browser: string;
      os: string;
      countryCode: string | null;
      region: string | null;
      city: string | null;
      inferredTz: string | null;
      revokedAt: Date | null;
    }>;
  }>({
    queryKey: ["/api/me/sessions"],
    enabled: !!user,
  });

  // Helper for safe date formatting
  const safeFmt = (ts: number | Date | null | undefined) => {
    if (ts == null) return "Unknown";
    const n = typeof ts === 'number' ? ts : ts.getTime();
    if (!Number.isFinite(n) || n <= 0) return "Unknown";
    const d = new Date(n);
    return isNaN(d.getTime()) ? "Unknown" : d.toLocaleString(locale);
  };

  // Format location from session data
  const formatLocation = (r: { city?: string | null; region?: string | null; countryCode?: string | null }) => {
    const parts = [r.city, r.region, r.countryCode].filter(Boolean);
    return parts.length ? parts.join(", ") : "Unknown location";
  };

  // Derived sessions array with isCurrent flag
  const activeSessions = sessionsResponse?.rows?.map(s => ({
    ...s,
    sessionId: s.id,
    isCurrent: s.id === sessionsResponse.currentSessionId,
    lastActiveAt: s.lastSeenAt,
  })) ?? [];

  // Fetch user preferences (country is immutable after signup; timezone edit is policy-controlled)
  type UserPreferencesResponse = {
    timezone?: string;
    language?: string;
    country?: string | null;
    countryLocked?: boolean;
    timezoneEditable?: boolean;
  };

  const { data: userPreferences } = useQuery<UserPreferencesResponse>({
    queryKey: ["/api/profile/preferences"],
    enabled: !!user,
  });

  const effectiveCountryIso2 = useMemo(() => {
    const raw = user?.countryIso2 || userPreferences?.country || preferences.country || "";
    return String(raw || "").trim().toUpperCase();
  }, [user?.countryIso2, userPreferences?.country, preferences.country]);

  const countryLocked = preferencePolicy.countryLocked || Boolean(effectiveCountryIso2);

  const timezoneRows = useMemo(() => {
    const rows = timezonesData?.rows ?? [];
    if (!rows.length) return [];
    if (!effectiveCountryIso2) return rows;

    const filtered = rows.filter(
      (r) => String(r.countryCode || "").toUpperCase() === effectiveCountryIso2
    );

    return filtered.length ? filtered : rows;
  }, [timezonesData?.rows, effectiveCountryIso2]);

  // Initialize preferences from API response - only on first load to prevent race conditions
  useEffect(() => {
    if (userPreferences && !preferencesInitialized) {
      const nextLanguage = normalizeLanguage(userPreferences.language);
      setPreferences({
        timezone: userPreferences.timezone || "UTC",
        language: nextLanguage,
        country: userPreferences.country || "",
      });
      setPreferencePolicy({
        timezoneEditable: userPreferences.timezoneEditable ?? true,
        countryLocked: Boolean(userPreferences.countryLocked ?? userPreferences.country),
      });
      setPreferencesInitialized(true);
    }
  }, [userPreferences, supportedLocales.join(","), preferencesInitialized]);

  useEffect(() => {
    if (!timezoneRows.length) return;
    const exists = timezoneRows.some((tz) => tz.name === preferences.timezone);
    if (!exists) {
      setPreferences((prev) => ({ ...prev, timezone: timezoneRows[0].name }));
    }
  }, [timezoneRows, preferences.timezone]);

  useEffect(() => {
    if (user && !formInitialized) {
      setFormData({
        username: user.username || "",
        name: user.name || "",
        phone: user.phone || "",
      });
      setPhoneValid(Boolean(user.phone));
      setFormInitialized(true);
    }
  }, [user, formInitialized]);

  const profileMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetchWithIdentity("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update profile");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Profile updated", description: "Your profile has been updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/current-user"] });
      checkAuth();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!effectiveCountryIso2) {
      toast({
        title: "Country required",
        description: "Your account does not have a country on file. Contact support if this is incorrect.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.phone || !phoneValid) {
      toast({ title: "Phone required", description: "Enter a valid phone number before saving.", variant: "destructive" });
      return;
    }

    profileMutation.mutate({ ...formData });
  };

  const passwordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const response = await fetchWithIdentity("/api/profile/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to change password");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed", description: "Your password has been updated successfully" });
      setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({ title: "Error", description: "New passwords do not match", variant: "destructive" });
      return;
    }

    if (passwordData.newPassword.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    if (passwordData.newPassword.length > 25) {
      toast({ title: "Error", description: "Password must be at most 25 characters", variant: "destructive" });
      return;
    }

    passwordMutation.mutate({
      currentPassword: passwordData.currentPassword,
      newPassword: passwordData.newPassword,
    });
  };

  const resetAccountAction = () => {
    setAccountAction(null);
    setAccountReasonCode("TAKING_BREAK");
    setAccountReasonText("");
    setAccountPassword("");
    setAccountConfirm("");
  };

  const accountActionMutation = useMutation({
    mutationFn: async (payload: {
      action: "deactivate" | "delete";
      reasonCode: string;
      reasonText: string | null;
      password: string;
      confirm: string;
    }) => {
      const endpoint = payload.action === "delete"
        ? "/api/profile/account/delete"
        : "/api/profile/account/deactivate";
      const response = await fetchWithIdentity(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          reasonCode: payload.reasonCode,
          reasonText: payload.reasonText,
          password: payload.password,
          confirm: payload.confirm,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update account status");
      }
      return response.json();
    },
    onSuccess: async (_data, variables) => {
      toast({
        title: variables.action === "delete" ? "Account deleted" : "Account deactivated",
        description: "You have been logged out.",
      });
      resetAccountAction();
      try {
        await logout();
      } catch (error) {
        console.warn("Logout after account action failed:", error);
      }
      window.location.href = "/login";
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAccountAction = () => {
    if (!accountAction) return;
    if (!accountReasonCode.trim()) {
      toast({ title: "Reason required", description: "Select a reason before continuing.", variant: "destructive" });
      return;
    }
    if (!accountPassword.trim()) {
      toast({ title: "Password required", description: "Enter your password to continue.", variant: "destructive" });
      return;
    }
    if (accountConfirm.trim().toUpperCase() !== accountConfirmToken) {
      toast({ title: "Confirmation required", description: `Type ${accountConfirmToken} to confirm.`, variant: "destructive" });
      return;
    }

    const trimmedReasonText = accountReasonText.trim();
    accountActionMutation.mutate({
      action: accountAction,
      reasonCode: accountReasonCode,
      reasonText: trimmedReasonText ? trimmedReasonText : null,
      password: accountPassword,
      confirm: accountConfirm,
    });
  };

  // Session termination mutation (using new /api/me/sessions endpoint)
  const terminateSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetchWithIdentity(`/api/me/sessions/${encodeURIComponent(sessionId)}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: "User revoked session from Profile Settings" }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to terminate session");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Session terminated", description: "The session has been logged out" });
      refetchSessions();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Terminate all other sessions mutation (using new /api/me/sessions endpoint)
  const terminateAllSessionsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithIdentity("/api/me/sessions/logout-others", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: "User logged out other devices from Profile Settings" }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to terminate sessions");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Sessions terminated", description: "All other sessions have been logged out" });
      refetchSessions();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update preferences mutation
  const preferencesMutation = useMutation({
    mutationFn: async (data: { timezone?: string; language?: string; country?: string }) => {
      const response = await fetchWithIdentity("/api/profile/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update preferences");
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      toast({ title: "Preferences saved", description: "Your preferences have been updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/profile/preferences"] });
      if (variables.language) {
        const normalized = normalizeLanguage(variables.language);
        updateUser({ language: normalized });
        setLocale(normalized);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Separate mutation for language that auto-saves immediately on change
  const languageMutation = useMutation({
    mutationFn: async (language: string) => {
      const response = await fetchWithIdentity("/api/profile/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ language }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update language");
      }
      return response.json();
    },
    onSuccess: (_data, language) => {
      // Invalidate the i18n bundle to force loading new translations
      // Don't invalidate user/preferences queries to avoid race conditions that reset language
      queryClient.invalidateQueries({ queryKey: ["i18nBundle", language] });
    },
    onError: (error: Error) => {
      const prevLanguage = previousLanguageRef.current;
      const prevLocale = previousLocaleRef.current;
      if (prevLanguage) {
        setPreferences((prev) => ({ ...prev, language: prevLanguage }));
        updateUser({ language: prevLanguage });
      }
      if (prevLocale) {
        setLocale(prevLocale);
      }
      toast({ title: "Error saving language", description: error.message, variant: "destructive" });
    },
  });

  const handlePreferencesUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedLanguage = normalizeLanguage(preferences.language);
    const payload: { timezone?: string; language?: string; country?: string } = {
      language: normalizedLanguage,
    };

    if (normalizedLanguage !== preferences.language) {
      setPreferences((prev) => ({ ...prev, language: normalizedLanguage }));
    }

    if (preferencePolicy.timezoneEditable) {
      payload.timezone = preferences.timezone;
    }

    if (!countryLocked && preferences.country) {
      payload.country = preferences.country;
    }

    preferencesMutation.mutate(payload);
  };

  const loading = profileMutation.isPending || passwordMutation.isPending || preferencesMutation.isPending;
  const [activeSection, setActiveSection] = useState<"profile" | "security" | "identity" | "devices" | "preferences">("profile");
  const profileSections = [
    { key: "profile", label: "My Profile", icon: User },
    { key: "security", label: "Security & Login", icon: Shield },
    { key: "identity", label: "Identity Verification", icon: CheckCircle },
    { key: "devices", label: "Devices & Activity", icon: Monitor },
    { key: "preferences", label: "Preferences", icon: Globe },
  ] as const;
  const accountConfirmMatches = accountConfirm.trim().toUpperCase() === accountConfirmToken;
  const accountActionDisabled = accountActionMutation.isPending
    || !accountReasonCode.trim()
    || !accountPassword.trim()
    || !accountConfirmMatches;

  return (
    <div className="min-h-screen min-h-dvh bg-neutral-900 text-white flex flex-col">
      <Header title="TradeQuip" />

      <main className="flex-1 page-pad">
        <div className="max-w-5xl w-full mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Profile Settings</h1>
                <p className="text-gray-400">Manage your account information and security</p>
              </div>
            </div>
            <TierBadge tier={((user as any)?.userTier as UserTier) || "CANDIDATE"} size="lg" />
          </div>

          <div className="-mx-2 px-2 overflow-x-auto">
            <div className="flex gap-2 min-w-max pb-2">
              {profileSections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.key;
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key)}
                    className={`shrink-0 flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${isActive ? "bg-white/10 text-white" : "bg-white/5 text-gray-400 hover:text-white"}`}
                    aria-pressed={isActive}
                  >
                    <Icon className="h-4 w-4" />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>

          {activeSection === "profile" && (
            <Card className="bg-neutral-800 border-gray-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Account Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleProfileUpdate} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={user?.email || ""}
                      disabled
                      className="bg-neutral-700 border-gray-600 text-gray-400"
                    />
                    <p className="text-xs text-gray-500">Email cannot be changed</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      placeholder="Enter username"
                      className="bg-neutral-700 border-gray-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Enter your full name"
                      className="bg-neutral-700 border-gray-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone" className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      Phone Number
                    </Label>
                    <PhoneNumberInput
                      countryIso2={effectiveCountryIso2}
                      value={formData.phone}
                      onChange={(e164, valid) => {
                        setFormData(prev => ({ ...prev, phone: e164 }));
                        setPhoneValid(valid);
                      }}
                      disabled={!effectiveCountryIso2}
                      required
                    />
                    {!effectiveCountryIso2 ? (
                      <p className="text-xs text-yellow-500">
                        Country is required for phone formatting. Contact support if it was not captured during signup.
                      </p>
                    ) : (
                      <p className="text-xs text-neutral-400">Country is derived from your signup jurisdiction.</p>
                    )}
                  </div>

                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Saving..." : "Save Changes"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {activeSection === "security" && (
            <>
              <Card className="bg-neutral-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-green-500" />
                    Account Security
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-neutral-700 rounded-lg">
                      <div>
                        <div className="font-medium">Account Status</div>
                        <div className="text-sm text-gray-400">Your account is active and in good standing</div>
                      </div>
                      <span className="px-2 py-1 bg-green-600 text-white text-xs rounded">Active</span>
                    </div>

                    <div className="flex justify-between items-center p-3 bg-neutral-700 rounded-lg">
                      <div>
                        <div className="font-medium">Member Since</div>
                        <div className="text-sm text-gray-400">
                          {formatDateTime(
                            user?.createdAt,
                            {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                            "N/A",
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center p-3 bg-neutral-700 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Smartphone className="h-4 w-4 text-gray-400" />
                        <div>
                          <div className="font-medium">Two-Factor Authentication</div>
                          <div className="text-sm text-gray-400">
                            {mfaStatus?.enabled ? (
                              <>
                                Enabled since{" "}
                                {mfaStatus.enabledAt ? new Date(mfaStatus.enabledAt).toLocaleDateString(locale) : "recently"}
                              </>
                            ) : (
                              <>Add an extra layer of security</>
                            )}
                          </div>
                        </div>
                      </div>
                      {mfaStatus?.enabled ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-green-600 text-white text-xs rounded flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" />
                            Enabled
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMfaDisableDialog(true)}
                            className="text-red-400 border-red-600 hover:bg-red-900/30"
                          >
                            Disable
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => mfaSetupMutation.mutate()}
                          disabled={mfaSetupMutation.isPending}
                          size="sm"
                        >
                          {mfaSetupMutation.isPending ? "..." : "Enable 2FA"}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-neutral-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5 text-yellow-500" />
                    Change Password
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="currentPassword">Current Password</Label>
                      <div className="relative">
                        <Input
                          id="currentPassword"
                          type={showPasswords.currentPassword ? "text" : "password"}
                          value={passwordData.currentPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                          placeholder="Enter current password"
                          className="bg-neutral-700 border-gray-600 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords({ ...showPasswords, currentPassword: !showPasswords.currentPassword })}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                        >
                          {showPasswords.currentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="newPassword">New Password</Label>
                      <div className="relative">
                        <Input
                          id="newPassword"
                          type={showPasswords.newPassword ? "text" : "password"}
                          value={passwordData.newPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                          placeholder="Enter new password"
                          className="bg-neutral-700 border-gray-600 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords({ ...showPasswords, newPassword: !showPasswords.newPassword })}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                        >
                          {showPasswords.newPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm New Password</Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          type={showPasswords.confirmPassword ? "text" : "password"}
                          value={passwordData.confirmPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                          placeholder="Confirm new password"
                          className="bg-neutral-700 border-gray-600 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords({ ...showPasswords, confirmPassword: !showPasswords.confirmPassword })}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                        >
                          {showPasswords.confirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <Button type="submit" disabled={loading} variant="outline" className="w-full">
                      {loading ? "Updating..." : "Change Password"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="bg-neutral-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Account Deactivation & Deletion
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm text-gray-400">
                    <p>Deactivation disables access immediately and hides you from trader-facing views.</p>
                    <p>Deletion is a permanent request that disables access while retaining data for audit.</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 mt-4">
                    <Button
                      variant="outline"
                      className="text-amber-400 border-amber-600 hover:bg-amber-900/30"
                      onClick={() => setAccountAction("deactivate")}
                    >
                      Deactivate Account
                    </Button>
                    <Button
                      variant="outline"
                      className="text-red-400 border-red-600 hover:bg-red-900/30"
                      onClick={() => setAccountAction("delete")}
                    >
                      Delete Account
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === "identity" && (
            <>
              <TierProgressCard tier={((user as any)?.userTier as UserTier) || "CANDIDATE"} />
              <VerificationSection />
            </>
          )}

          {activeSection === "devices" && (
            <>
              <Card className="bg-neutral-800 border-gray-700">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <LogOut className="h-5 w-5 text-orange-500" />
                    Active Sessions
                  </CardTitle>
                  {Array.isArray(activeSessions) && activeSessions.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => terminateAllSessionsMutation.mutate()}
                      disabled={terminateAllSessionsMutation.isPending}
                      className="text-red-400 border-red-600 hover:bg-red-900/30"
                    >
                      {terminateAllSessionsMutation.isPending ? "..." : "Terminate All Others"}
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Array.isArray(activeSessions) && activeSessions.length > 0 ? (
                      activeSessions.map((session: any) => (
                        <div key={session.id} className={`flex justify-between items-center p-3 rounded-lg ${session.isCurrent ? 'bg-green-900/30 border border-green-600/50' : 'bg-neutral-700'}`}>
                          <div className="flex items-center gap-3">
                            <Monitor className="h-4 w-4 text-gray-400" />
                            <div>
                              <div className="text-sm font-medium flex items-center gap-2">
                                {session.browser || session.deviceType || "Unknown Device"}
                                {session.isCurrent && (
                                  <span className="text-xs px-2 py-0.5 bg-green-600 text-white rounded">Current</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-400">
                                IP: {session.ip || "Unknown"} • {session.os || "Unknown OS"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-xs text-gray-500 text-right">
                              <div>Last active: {safeFmt(session.lastActiveAt)}</div>
                              <div className="text-gray-600">{formatLocation(session)}</div>
                            </div>
                            {!session.isCurrent && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => terminateSessionMutation.mutate(session.sessionId)}
                                disabled={terminateSessionMutation.isPending}
                                className="text-red-400 hover:text-red-300 hover:bg-red-900/30"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-gray-400 py-4">No active sessions</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-neutral-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Monitor className="h-5 w-5 text-blue-500" />
                    Recent Login Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Array.isArray(loginHistory) && loginHistory.length > 0 ? (
                      loginHistory.slice(0, 5).map((login: any, index: number) => (
                        <div key={index} className="flex justify-between items-center p-3 bg-neutral-700 rounded-lg">
                          <div className="flex items-center gap-3">
                            <Clock className="h-4 w-4 text-gray-400" />
                            <div>
                              <div className="text-sm font-medium">
                                {login.success ? "Successful login" : "Failed login attempt"}
                              </div>
                              <div className="text-xs text-gray-400">
                                IP: {login.ip || "Unknown"} • {login.userAgent?.substring(0, 30) || "Unknown device"}...
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-xs px-2 py-0.5 rounded ${login.success ? "bg-green-600/30 text-green-400" : "bg-red-600/30 text-red-400"}`}>
                              {login.success ? "Success" : "Failed"}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {(() => {
                                const raw = (login as any).eventAt ?? (login as any).createdAt ?? (login as any).at;
                                return formatDateTime(raw, undefined, "Unknown");
                              })()}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-gray-400 py-4">No login history available</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === "preferences" && (
            <>
              <Card className="bg-neutral-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-cyan-500" />
                    Regional Preferences
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePreferencesUpdate} className="space-y-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Timezone
                      </Label>
                      <Select
                        value={preferences.timezone}
                        onValueChange={(value) => setPreferences({ ...preferences, timezone: value })}
                      >
                        <SelectTrigger className="bg-neutral-700 border-gray-600" disabled={!preferencePolicy.timezoneEditable}>
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {timezoneRows.length > 0 ? (
                            timezoneRows.map((tz) => (
                              <SelectItem key={tz.name} value={tz.name}>
                                {tz.label}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="UTC">UTC</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      {!preferencePolicy.timezoneEditable && (
                        <p className="text-xs text-neutral-400">
                          Timezone editing is disabled by an administrator.
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Languages className="h-4 w-4" />
                        Language
                      </Label>
                      <Select
                        value={preferences.language}
                        onValueChange={(value) => {
                          void handleLanguageChange(value);
                        }}
                      >
                        <SelectTrigger className="bg-neutral-700 border-gray-600">
                          <SelectValue placeholder="Select language" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {languageOptions.length > 0 ? (
                            languageOptions.map((lang) => (
                              <SelectItem key={lang.code} value={lang.code}>
                                {lang.nativeName} ({lang.name})
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="en">English</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      {!preferencePolicy.timezoneEditable && (
                        <p className="text-xs text-neutral-400">
                          Timezone editing is disabled by an administrator.
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        Country / Region
                      </Label>
                      <Select
                        value={preferences.country || effectiveCountryIso2 || "none"}
                        onValueChange={(value) => setPreferences({ ...preferences, country: value === "none" ? "" : value })}
                      >
                        <SelectTrigger className="bg-neutral-700 border-gray-600" disabled={countryLocked}>
                          <SelectValue placeholder="Select country" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="none">Not specified</SelectItem>
                          {countriesData?.rows?.map((c) => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {countryLocked && (
                        <p className="text-xs text-neutral-400">
                          Country is locked to your signup jurisdiction.
                        </p>
                      )}
                    </div>

                    <Button type="submit" disabled={loading} variant="outline" className="w-full">
                      {preferencesMutation.isPending ? "Saving..." : "Save Preferences"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="bg-neutral-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-amber-500" />
                    Notification Preferences
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium">Trade Executed</div>
                        <div className="text-sm text-gray-400">Get notified when a trade opens or closes</div>
                      </div>
                      <Switch
                        checked={notifications.tradeExecuted}
                        onCheckedChange={(checked) => setNotifications({ ...notifications, tradeExecuted: checked })}
                      />
                    </div>

                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium">Margin Warning</div>
                        <div className="text-sm text-gray-400">Alert when margin level is low</div>
                      </div>
                      <Switch
                        checked={notifications.marginWarning}
                        onCheckedChange={(checked) => setNotifications({ ...notifications, marginWarning: checked })}
                      />
                    </div>

                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium">Stop Loss / Take Profit Hit</div>
                        <div className="text-sm text-gray-400">Get notified when SL/TP is triggered</div>
                      </div>
                      <Switch
                        checked={notifications.stopLossHit}
                        onCheckedChange={(checked) => setNotifications({ ...notifications, stopLossHit: checked })}
                      />
                    </div>

                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium">Daily Summary</div>
                        <div className="text-sm text-gray-400">Receive a daily trading summary</div>
                      </div>
                      <Switch
                        checked={notifications.dailySummary}
                        onCheckedChange={(checked) => setNotifications({ ...notifications, dailySummary: checked })}
                      />
                    </div>

                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium">Promotions & Updates</div>
                        <div className="text-sm text-gray-400">News about new features and offers</div>
                      </div>
                      <Switch
                        checked={notifications.promotions}
                        onCheckedChange={(checked) => setNotifications({ ...notifications, promotions: checked })}
                      />
                    </div>

                    <p className="text-xs text-gray-500 pt-2">
                      Notification settings are stored locally. Email notifications coming soon.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-neutral-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5 text-purple-500" />
                    Trading Preferences
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-gray-400">
                    <p className="text-sm">
                      Your trading parameters (leverage, max trades, hold times) are managed by your account administrator.
                      Contact support if you need adjustments.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-neutral-700 rounded-lg">
                        <div className="text-xs text-gray-500">Leverage</div>
                        <div className="font-medium text-white">{(user as any)?.leverage || 50}x</div>
                      </div>
                      <div className="p-3 bg-neutral-700 rounded-lg">
                        <div className="text-xs text-gray-500">Max Trades</div>
                        <div className="font-medium text-white">{(user as any)?.maxConcurrent || 5}</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <div className="h-16 lg:hidden" />
        </div>
      </main>

      {/* 2FA Setup Dialog */}
      <Dialog open={mfaSetupDialog} onOpenChange={(open) => !open && closeMfaSetupDialog()}>
        <DialogContent className="bg-neutral-800 border-gray-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              {mfaRecoveryCodes ? "Save Your Recovery Codes" : "Set Up Two-Factor Authentication"}
            </DialogTitle>
            <DialogDescription>
              {mfaRecoveryCodes
                ? "Store these codes in a safe place. You'll need one if you lose access to your authenticator app."
                : "Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)"}
            </DialogDescription>
          </DialogHeader>

          {mfaRecoveryCodes ? (
            <div className="space-y-4">
              <div className="bg-neutral-900 p-4 rounded-lg border border-gray-700">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {mfaRecoveryCodes.map((code, i) => (
                    <div key={i} className="p-2 bg-neutral-800 rounded text-center">
                      {code}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 bg-amber-900/30 border border-amber-600/50 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                <p className="text-sm text-amber-200">
                  Each code can only be used once. Keep them secure!
                </p>
              </div>
              <DialogFooter className="flex gap-2">
                <Button variant="outline" onClick={copyRecoveryCodes} className="flex items-center gap-2">
                  <Copy className="h-4 w-4" />
                  Copy Codes
                </Button>
                <Button onClick={closeMfaSetupDialog}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {mfaQrCode && (
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <img src={mfaQrCode} alt="2FA QR Code" className="w-48 h-48" />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="mfa-code">Enter the 6-digit code from your app</Label>
                <Input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={mfaVerifyCode}
                  onChange={(e) => setMfaVerifyCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="bg-neutral-700 border-gray-600 text-center text-2xl tracking-widest font-mono"
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeMfaSetupDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleMfaEnable}
                  disabled={mfaVerifyCode.length !== 6 || mfaEnableMutation.isPending}
                >
                  {mfaEnableMutation.isPending ? "Verifying..." : "Verify & Enable"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 2FA Disable Dialog */}
      <Dialog open={mfaDisableDialog} onOpenChange={setMfaDisableDialog}>
        <DialogContent className="bg-neutral-800 border-gray-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Disable Two-Factor Authentication
            </DialogTitle>
            <DialogDescription>
              This will remove the extra security layer from your account. Enter your current 2FA code to confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="disable-code">Enter your 6-digit code</Label>
              <Input
                id="disable-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaDisableCode}
                onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="bg-neutral-700 border-gray-600 text-center text-2xl tracking-widest font-mono"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setMfaDisableDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => mfaDisableMutation.mutate(mfaDisableCode)}
                disabled={mfaDisableCode.length !== 6 || mfaDisableMutation.isPending}
              >
                {mfaDisableMutation.isPending ? "Disabling..." : "Disable 2FA"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={accountAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            resetAccountAction();
          }
        }}
      >
        <DialogContent className="bg-neutral-800 border-gray-700 max-w-lg">
          <DialogHeader>
            <DialogTitle
              className={`flex items-center gap-2 ${accountAction === "delete" ? "text-red-400" : "text-amber-400"}`}
            >
              <AlertTriangle className="h-5 w-5" />
              {accountActionLabel} Account
            </DialogTitle>
            <DialogDescription>
              {accountAction === "delete"
                ? "This request disables access and marks the account as deleted. Data is retained for audit."
                : "This disables access immediately and logs you out on all devices."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={accountReasonCode} onValueChange={setAccountReasonCode}>
                <SelectTrigger className="bg-neutral-700 border-gray-600">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {accountReasonOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-reason-text">Additional details (optional)</Label>
              <Textarea
                id="account-reason-text"
                value={accountReasonText}
                onChange={(e) => setAccountReasonText(e.target.value)}
                className="bg-neutral-700 border-gray-600"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-password">Password</Label>
              <div className="relative">
                <Input
                  id="account-password"
                  type={showPasswords.accountPassword ? "text" : "password"}
                  value={accountPassword}
                  onChange={(e) => setAccountPassword(e.target.value)}
                  autoComplete="current-password"
                  className="bg-neutral-700 border-gray-600 pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
                  onClick={() => setShowPasswords({ ...showPasswords, accountPassword: !showPasswords.accountPassword })}
                  aria-label={showPasswords.accountPassword ? "Hide password" : "Show password"}
                >
                  {showPasswords.accountPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-confirm">Type {accountConfirmToken} to confirm</Label>
              <Input
                id="account-confirm"
                value={accountConfirm}
                onChange={(e) => setAccountConfirm(e.target.value)}
                className="bg-neutral-700 border-gray-600"
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={resetAccountAction}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className={accountAction === "delete"
                ? "text-red-400 border-red-600 hover:bg-red-900/30"
                : "text-amber-400 border-amber-600 hover:bg-amber-900/30"}
              onClick={handleAccountAction}
              disabled={accountActionDisabled}
            >
              {accountActionMutation.isPending ? "Working..." : `${accountActionLabel} Account`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
