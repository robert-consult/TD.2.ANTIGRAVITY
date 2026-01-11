import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";

function getTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.get("token");
}

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const token = useMemo(() => getTokenFromUrl(), []);
  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Missing verification token.");
        return;
      }

      setStatus("verifying");
      try {
        const res = await fetchWithIdentity("/api/verification/email/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          credentials: "include",
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setMessage(data?.message || "Verification failed. The token may be expired or already used.");
          return;
        }

        setStatus("success");
        setMessage("Your email has been verified successfully.");
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message || "Verification failed due to a network error.");
      }
    };

    run();
  }, [token]);

  return (
    <div className="min-h-screen min-h-dvh flex items-center justify-center bg-neutral-900 page-pad">
      <Card className="w-full max-w-md bg-neutral-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Email Verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "verifying" && (
            <div className="flex items-center gap-2 text-gray-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Verifying your email...</span>
            </div>
          )}

          {status === "success" && (
            <>
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span>{message}</span>
              </div>
              <div className="flex gap-2 pt-4">
                <Button onClick={() => setLocation("/")}>Go to Dashboard</Button>
                <Link href="/profile">
                  <Button variant="outline">Profile Settings</Button>
                </Link>
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <div className="flex items-center gap-2 text-red-400">
                <XCircle className="h-5 w-5" />
                <span>{message}</span>
              </div>
              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={() => setLocation("/profile")}>
                  Open Profile Settings
                </Button>
                <Button variant="ghost" onClick={() => setLocation("/")}>
                  Home
                </Button>
              </div>
            </>
          )}

          {status === "idle" && (
            <div className="text-gray-300">Waiting for token...</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
