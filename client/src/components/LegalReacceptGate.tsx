import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type Doc1ReacceptStatusResponse = {
  ok: boolean;
  docSet: "DOC1";
  required: boolean;
  blocked: boolean;
  blockedReason: string | null;
  countryIso2: string | null;
  regionKey: string | null;
  requiredCombinedSha256: string | null;
  lastAcceptedCombinedSha256: string | null;
  terms:
    | null
    | {
        countryIso2: string;
        regionKey: string | null;
        combinedSha256: string;
        token: string;
        text: string;
        warnings?: string[];
      };
};

export function LegalReacceptGate() {
  const { user, checkAuth } = useAuth();
  const { toast } = useToast();

  const [forcedOpen, setForcedOpen] = useState(false);
  const open = Boolean(user && (user.legalReacceptRequired || forcedOpen));
  const isImpersonating = Boolean(user?.isImpersonating);

  const [status, setStatus] = useState<Doc1ReacceptStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!open) {
      setStatus(null);
      setHasReachedEnd(false);
      setAccepted(false);
      return;
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    setHasReachedEnd(false);
    setAccepted(false);
  }, [open, status?.terms?.combinedSha256]);

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await apiRequest("GET", "/api/legal/doc1/reaccept");
        const data = (await res.json().catch(() => null)) as Doc1ReacceptStatusResponse | null;
        if (canceled) return;
        if (!data || !data.ok) throw new Error("LEGAL_REACCEPT_STATUS_FAILED");
        setStatus(data);

        if (!data.required) {
          setForcedOpen(false);
        }
      } catch (e: any) {
        if (canceled) return;
        toast({
          title: "Legal status unavailable",
          description: String(e?.message || e),
          variant: "destructive",
        });
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [open, toast]);

  useEffect(() => {
    const handler = async () => {
      setForcedOpen(true);
      try {
        await checkAuth();
      } catch {
        // ignore
      }
    };

    window.addEventListener("legal:reaccept-required", handler as any);
    return () => window.removeEventListener("legal:reaccept-required", handler as any);
  }, [checkAuth]);

  useEffect(() => {
    if (!user?.legalReacceptRequired) setForcedOpen(false);
  }, [user?.legalReacceptRequired]);

  const canAccept = useMemo(() => {
    if (!status?.required) return false;
    if (!status.terms?.token || !status.terms?.combinedSha256) return false;
    if (!hasReachedEnd || !accepted) return false;
    if (submitting || loading) return false;
    return true;
  }, [accepted, hasReachedEnd, loading, status?.required, status?.terms?.combinedSha256, status?.terms?.token, submitting]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || hasReachedEnd) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    if (atBottom) setHasReachedEnd(true);
  };

  const acceptNow = async () => {
    if (!status?.terms?.token || !status.terms.combinedSha256) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/legal/doc1/accept", {
        termsToken: status.terms.token,
        combinedSha256: status.terms.combinedSha256,
      });
      toast({ title: "Terms accepted" });
      await checkAuth();
      setForcedOpen(false);
    } catch (e: any) {
      toast({
        title: "Could not accept terms",
        description: String(e?.message || e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}} modal={!isImpersonating}>
      <DialogContent
        className={cn(
          "max-w-3xl flex flex-col",
          isImpersonating
            ? "top-[calc(50%+1.25rem)] max-h-[calc(100vh-5.5rem)]"
            : "max-h-[90vh]",
        )}
      >
        <DialogHeader>
          <DialogTitle>Updated Terms & Conditions</DialogTitle>
          <DialogDescription>
            You must review and accept the latest terms before placing trades.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 relative">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-[240px] max-h-[55vh] overflow-auto border rounded-md p-4 whitespace-pre-wrap text-sm leading-relaxed bg-muted/30"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
          >
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading latest terms…
              </div>
            ) : (
              status?.terms?.text || "No terms loaded."
            )}
          </div>

          {!hasReachedEnd && Boolean(status?.terms?.text) && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent pointer-events-none flex items-end justify-center pb-2">
              <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">Scroll down to continue</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-3 mt-3">
          <div className="flex-1 min-w-0 space-y-2">
            {status?.terms?.combinedSha256 ? (
              <div className="text-xs text-muted-foreground break-all select-all">
                Document hash: {status.terms.combinedSha256}
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Checkbox
                id="legal-reaccept"
                checked={accepted}
                onCheckedChange={(v) => setAccepted(Boolean(v))}
                disabled={!hasReachedEnd || loading}
              />
              <label htmlFor="legal-reaccept" className="text-sm cursor-pointer select-none">
                I accept the Terms & Conditions
              </label>
            </div>
          </div>

          <div className="flex gap-2 w-full sm:w-auto">
            <Button onClick={acceptNow} disabled={!canAccept} className="w-full sm:w-auto">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Accept & Continue"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
