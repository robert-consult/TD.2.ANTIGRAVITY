import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { AlertTriangle, Mail, Clock, Shield } from "lucide-react";

export function VerificationReminderPopup() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (user.emailVerified) return;
    if (dismissed) return;
    
    const dismissedKey = `verification_reminder_dismissed_${user.id}`;
    const lastDismissed = sessionStorage.getItem(dismissedKey);
    
    if (lastDismissed) {
      setDismissed(true);
      return;
    }
    
    const timer = setTimeout(() => {
      setShowDialog(true);
    }, 500);
    
    return () => clearTimeout(timer);
  }, [user, loading, dismissed]);

  if (!user || user.emailVerified || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    const dismissedKey = `verification_reminder_dismissed_${user.id}`;
    sessionStorage.setItem(dismissedKey, Date.now().toString());
    setDismissed(true);
    setShowDialog(false);
  };

  const handleVerifyNow = () => {
    setShowDialog(false);
    navigate("/profile");
  };

  const daysRemaining = user.gracePeriodEndsAt 
    ? Math.max(0, Math.ceil((user.gracePeriodEndsAt - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const isLocked = user.inGracePeriod === false && user.emailVerified === false;

  return (
    <Dialog open={showDialog} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent className="sm:max-w-md bg-neutral-800 border-gray-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {isLocked ? (
              <>
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <span className="text-red-400">Account Locked</span>
              </>
            ) : (
              <>
                <Mail className="h-5 w-5 text-amber-500" />
                <span className="text-amber-400">Verify Your Email</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-gray-300 pt-2">
            {isLocked ? (
              <div className="space-y-3">
                <p>
                  Your email address <span className="font-medium text-white">{user.email}</span> has not been verified.
                </p>
                <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-600/50 rounded-lg">
                  <Shield className="h-4 w-4 text-red-400 shrink-0" />
                  <span className="text-sm text-red-300">
                    Trading is restricted until you verify your email address.
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p>
                  Please verify your email address <span className="font-medium text-white">{user.email}</span> to unlock full trading access.
                </p>
                <div className="flex items-center gap-2 p-3 bg-amber-900/30 border border-amber-600/50 rounded-lg">
                  <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="text-sm text-amber-300">
                    {daysRemaining > 0 ? (
                      <>
                        {daysRemaining}{" "}
                        {daysRemaining === 1 ? "day remaining in grace period" : "days remaining in grace period"}
                      </>
                    ) : (
                      <>Grace period ends today</>
                    )}
                  </span>
                </div>
              </div>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleDismiss}
            className="border-gray-600 hover:bg-neutral-700"
          >
            Remind Me Later
          </Button>
          <Button
            onClick={handleVerifyNow}
            className={isLocked ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}
          >
            Verify Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
