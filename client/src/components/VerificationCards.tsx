import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { 
  Mail, 
  Phone, 
  Shield, 
  Wallet, 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Lock, 
  Send, 
  RefreshCw,
  BadgeCheck
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type React from "react";
import { useI18n } from "@/i18n";

interface PolicySnapshot {
  derived: {
    accountState: string;
    contenderEligible: boolean;
    contenderPath1: boolean;
    contenderPath2: boolean;
    isSelectedForKyc: boolean;
    emailInitialDueAt: string;
    emailReverifyDueAt: string | null;
    isEmailInitialOverdue: boolean;
    isEmailReverifyOverdue: boolean;
  } | null;
  user: {
    userTier: string;
    contenderTier: string;
    emailVerifiedAt: string | null;
    emailReverifyDueAt: string | null;
    emailInitialDueAt: string | null;
    phoneVerifiedAt: string | null;
    selectedAt: string | null;
  };
  features: {
    canSendEmailVerification: boolean;
    canStartSms: boolean;
    canConfirmSms: boolean;
    canViewKyc: boolean;
    canSubmitKyc: boolean;
    canSetPreferredPaymentCurrency: boolean;
    canRequestPayout: boolean;
    canTradeOpenOrIncrease: boolean;
    canTradeCloseOrReduce: boolean;
    canTradeCancelPending: boolean;
    canTradeModifySltp: boolean;
  };
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
  correlationId?: string;
}

export function EmailVerificationCard() {
  const { toast } = useToast();
  const { locale } = useI18n();
  
  const { data: status, refetch } = useQuery<PolicySnapshot>({
    queryKey: ["/api/policy/snapshot"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/verification/email/send");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Email Sent", description: "Check your inbox for the verification link." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/policy/snapshot"] });
    },
    onError: (error: Error) => {
      const apiError = error as ApiError;
      if (apiError.status === 401 || apiError.status === 403) {
        toast({ title: "Access Denied", description: "Please log in to continue.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    },
  });

  const getStatusDisplay = () => {
    const emailVerifiedAt = status?.user?.emailVerifiedAt;
    const reverifyDueAt = status?.user?.emailReverifyDueAt ?? null;
    const graceEndsAt = status?.user?.emailInitialDueAt ?? status?.derived?.emailInitialDueAt ?? null;
    if (emailVerifiedAt) {
      return {
        icon: <CheckCircle className="h-5 w-5 text-green-500" />,
        badge: "Verified",
        badgeClass: "bg-green-600 text-white",
        description: reverifyDueAt
          ? (
            <>
              Re-verify by {new Date(reverifyDueAt).toLocaleDateString(locale)}
            </>
          )
          : (
            <>Your email is verified</>
          ),
      };
    }
    if (graceEndsAt && new Date(graceEndsAt) > new Date()) {
      return {
        icon: <Clock className="h-5 w-5 text-yellow-500" />,
        badge: "Pending",
        badgeClass: "bg-yellow-600 text-white",
        description: (
          <>
            Verify before {new Date(graceEndsAt).toLocaleDateString(locale)}
          </>
        ),
      };
    }
    return {
      icon: <AlertCircle className="h-5 w-5 text-red-500" />,
      badge: "Not Verified",
      badgeClass: "bg-red-600 text-white",
      description: <>Verify to continue trading</>,
    };
  };

  const statusDisplay = getStatusDisplay() as {
    icon: React.ReactNode;
    badge: string;
    badgeClass: string;
    description: React.ReactNode;
  };

  return (
    <Card className="bg-neutral-800 border-gray-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-500" />
            Email Verification
          </div>
          <span className={`text-xs px-2 py-1 rounded ${statusDisplay.badgeClass}`}>
            {statusDisplay.badge}
          </span>
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          {statusDisplay.icon}
          {statusDisplay.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!status?.user?.emailVerifiedAt && (
          <Button 
            onClick={() => sendEmailMutation.mutate()}
            disabled={sendEmailMutation.isPending || !status?.features?.canSendEmailVerification}
            className="w-full"
            variant={status?.user?.emailInitialDueAt && new Date(status.user?.emailInitialDueAt).getTime() > Date.now() ? "outline" : "default"}
          >
            {sendEmailMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {sendEmailMutation.isPending ? "Sending..." : "Send Verification Email"}
          </Button>
        )}
        {status?.user?.emailVerifiedAt && status.user?.emailReverifyDueAt && (
          <div className="text-sm text-gray-400">
            Next re-verification: {new Date(status.user?.emailReverifyDueAt).toLocaleDateString(locale)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SmsVerificationCard() {
  const { toast } = useToast();
  const { locale } = useI18n();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [showCodeInput, setShowCodeInput] = useState(false);
  
  const { data: status, refetch } = useQuery<PolicySnapshot>({
    queryKey: ["/api/policy/snapshot"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const startSmsMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const response = await apiRequest("POST", "/api/verification/sms/start", { phone: phoneNumber });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Code Sent", description: "Enter the verification code from your phone." });
      setShowCodeInput(true);
    },
    onError: (error: Error) => {
      const apiError = error as ApiError;
      if (apiError.status === 401 || apiError.status === 403) {
        toast({ title: "Access Denied", description: "Please log in to continue.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    },
  });

  const confirmSmsMutation = useMutation({
    mutationFn: async (verifyCode: string) => {
      const response = await apiRequest("POST", "/api/verification/sms/confirm", { code: verifyCode });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Verified!", description: "Your phone number has been verified." });
      setShowCodeInput(false);
      setCode("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/policy/snapshot"] });
    },
    onError: (error: Error) => {
      const apiError = error as ApiError;
      if (apiError.status === 401 || apiError.status === 403) {
        toast({ title: "Access Denied", description: "Please log in to continue.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    },
  });

  const isLocked = !status?.features?.canStartSms;
  const isVerified = !!status?.user?.phoneVerifiedAt;

  if (isLocked) {
    return (
      <Card className="bg-neutral-800 border-gray-700 opacity-60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-gray-500" />
              Phone Verification
            </div>
            <Lock className="h-4 w-4 text-gray-500" />
          </CardTitle>
          <CardDescription>
            Unlock by meeting contender requirements
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-500">
            <p>Requirements to unlock:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Email verified</li>
              <li>Path 1: {status?.contenderCriteria?.path1?.minAgeDays ?? 30}+ days, {Math.round((status?.contenderCriteria?.path1?.minBalanceMultiplier ?? 1.2) * 100)}%+ return, {status?.contenderCriteria?.path1?.minTradesLifetime ?? 30}+ trades</li>
              <li>Path 2: {status?.contenderCriteria?.path2?.minAgeDays ?? 90}+ days, {Math.round((status?.contenderCriteria?.path2?.minReturnPct ?? 0.1) * 100)}%+ last {status?.contenderCriteria?.path2?.minAgeDays ?? 90}d return, {status?.contenderCriteria?.path2?.minTradesWindow ?? 20}+ trades</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-neutral-800 border-gray-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-purple-500" />
            Phone Verification
          </div>
          {isVerified && (
            <span className="text-xs px-2 py-1 rounded bg-green-600 text-white">
              Verified
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {isVerified ? (
            <>
              Verified on{" "}
              {status.user?.phoneVerifiedAt ? new Date(status.user.phoneVerifiedAt).toLocaleDateString(locale) : "recently"}
            </>
          ) : (
            <>Verify your phone for enhanced security</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isVerified && !showCodeInput && (
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number (E.164 format)</Label>
            <div className="flex gap-2">
              <Input
                id="phone"
                type="tel"
                placeholder="+1234567890"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-neutral-700 border-gray-600"
              />
              <Button 
                onClick={() => startSmsMutation.mutate(phone)}
                disabled={startSmsMutation.isPending || !phone}
              >
                {startSmsMutation.isPending ? "..." : "Send Code"}
              </Button>
            </div>
          </div>
        )}
        {!isVerified && showCodeInput && (
          <div className="space-y-2">
            <Label htmlFor="code">Verification Code</Label>
            <div className="flex gap-2">
              <Input
                id="code"
                type="text"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className="bg-neutral-700 border-gray-600"
              />
              <Button 
                onClick={() => confirmSmsMutation.mutate(code)}
                disabled={confirmSmsMutation.isPending || code.length < 6}
              >
                {confirmSmsMutation.isPending ? "..." : "Verify"}
              </Button>
            </div>
            <button 
              className="text-sm text-blue-400 hover:underline"
              onClick={() => setShowCodeInput(false)}
            >
              Change phone number
            </button>
          </div>
        )}
        {isVerified && (
          <div className="flex items-center gap-2 text-green-500">
            <CheckCircle className="h-5 w-5" />
            <span>Phone number verified</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function KycStatusCard() {
  const { data: status } = useQuery<PolicySnapshot>({
    queryKey: ["/api/policy/snapshot"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: kycProfile } = useQuery<{
    status: string;
    invitedAt: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
  }>({
    queryKey: ["/api/profile/kyc"],
    enabled: status?.features?.canViewKyc,
  });

  const isLocked = !status?.features?.canViewKyc;

  if (isLocked) {
    return (
      <Card className="bg-neutral-800 border-gray-700 opacity-60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BadgeCheck className="h-5 w-5 text-gray-500" />
              KYC Verification
            </div>
            <Lock className="h-4 w-4 text-gray-500" />
          </CardTitle>
          <CardDescription>
            Available for selected traders only
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-500">
            KYC verification is invite-only. Continue trading to become eligible.
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (s: string) => {
    switch (s) {
      case "APPROVED": return "bg-green-600";
      case "INVITED": return "bg-blue-600";
      case "SUBMITTED": return "bg-yellow-600";
      case "REJECTED": return "bg-red-600";
      default: return "bg-gray-600";
    }
  };

  return (
    <Card className="bg-neutral-800 border-gray-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-emerald-500" />
            KYC Verification
          </div>
          {kycProfile?.status && (
            <span className={`text-xs px-2 py-1 rounded text-white ${getStatusColor(kycProfile.status)}`}>
              {kycProfile.status}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {kycProfile?.status === "APPROVED" 
            ? "Identity verified - eligible for payouts"
            : kycProfile?.status === "INVITED"
            ? "You've been invited to complete KYC"
            : kycProfile?.status === "SUBMITTED"
            ? "Under review"
            : kycProfile?.status === "REJECTED"
            ? kycProfile.rejectionReason || "Please contact support"
            : "Not started"
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        {kycProfile?.status === "INVITED" && (
          <Button className="w-full">
            <Shield className="h-4 w-4 mr-2" />
            Start KYC Process
          </Button>
        )}
        {kycProfile?.status === "APPROVED" && (
          <div className="flex items-center gap-2 text-green-500">
            <CheckCircle className="h-5 w-5" />
            <span>Identity verified</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PayoutProfileCard() {
  const { toast } = useToast();
  const [currency, setCurrency] = useState("USD");
  
  const { data: status } = useQuery<PolicySnapshot>({
    queryKey: ["/api/policy/snapshot"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: payoutProfile, refetch } = useQuery<{
    preferredPaymentCurrency: string;
    payoutMethod: string | null;
    isVerified: boolean;
  }>({
    queryKey: ["/api/profile/payout"],
    enabled: status?.features?.canSetPreferredPaymentCurrency,
  });

  const updateCurrencyMutation = useMutation({
    mutationFn: async (newCurrency: string) => {
      const response = await apiRequest("PUT", "/api/profile/payout/currency", { currency: newCurrency });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Updated", description: "Payment currency preference saved." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/profile/payout"] });
    },
    onError: (error: Error) => {
      const apiError = error as ApiError;
      if (apiError.status === 401 || apiError.status === 403) {
        toast({ title: "Access Denied", description: "Please log in to continue.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    },
  });

  const isLocked = !status?.features?.canSetPreferredPaymentCurrency;

  if (isLocked) {
    return (
      <Card className="bg-neutral-800 border-gray-700 opacity-60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-gray-500" />
              Payout Settings
            </div>
            <Lock className="h-4 w-4 text-gray-500" />
          </CardTitle>
          <CardDescription>
            Available after KYC approval
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-500">
            Complete KYC verification to set up your payout preferences.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-neutral-800 border-gray-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-amber-500" />
          Payout Settings
        </CardTitle>
        <CardDescription>
          Manage your payment preferences
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Preferred Currency</Label>
          <Select 
            value={payoutProfile?.preferredPaymentCurrency || currency} 
            onValueChange={(val) => {
              setCurrency(val);
              updateCurrencyMutation.mutate(val);
            }}
          >
            <SelectTrigger className="bg-neutral-700 border-gray-600">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD - US Dollar</SelectItem>
              <SelectItem value="EUR">EUR - Euro</SelectItem>
              <SelectItem value="GBP">GBP - British Pound</SelectItem>
              <SelectItem value="CHF">CHF - Swiss Franc</SelectItem>
              <SelectItem value="JPY">JPY - Japanese Yen</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {status?.features?.canRequestPayout && (
          <Button variant="outline" className="w-full">
            Request Payout
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function VerificationSection() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        Verification & Security
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <EmailVerificationCard />
        <SmsVerificationCard />
        <KycStatusCard />
        <PayoutProfileCard />
      </div>
    </div>
  );
}
