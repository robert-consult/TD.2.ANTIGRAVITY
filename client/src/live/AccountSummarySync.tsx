import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAccountSummary } from "@/hooks/use-account-summary";
import { markFreshData } from "@/lib/staleData";

export function AccountSummarySync() {
  const { user, isAuthenticated, updateUser } = useAuth();
  const { summary, isFetchedAfterMount } = useAccountSummary({ enabled: isAuthenticated });

  useEffect(() => {
    if (!summary || !isFetchedAfterMount) return;
    markFreshData("/api/account/summary");
  }, [isFetchedAfterMount, summary]);

  useEffect(() => {
    if (!user || !summary) return;

    const nextStartingEquity = Number.isFinite(summary.startingBalance)
      ? summary.startingBalance
      : user.startingEquity;
    const nextBalance = Number.isFinite(summary.balance) ? summary.balance.toFixed(2) : user.balance;
    const nextEquity = Number.isFinite(summary.equity) ? summary.equity : user.equity;
    const nextFreeMargin = Number.isFinite(summary.freeMargin) ? summary.freeMargin : user.freeMargin;
    const nextUsedMargin = Number.isFinite(summary.usedMargin) ? summary.usedMargin : user.usedMargin;

    if (
      user.startingEquity === nextStartingEquity &&
      user.balance === nextBalance &&
      user.equity === nextEquity &&
      user.freeMargin === nextFreeMargin &&
      user.usedMargin === nextUsedMargin
    ) {
      return;
    }

    updateUser({
      startingEquity: nextStartingEquity,
      balance: nextBalance,
      equity: nextEquity,
      freeMargin: nextFreeMargin,
      usedMargin: nextUsedMargin,
    });
  }, [summary, updateUser, user]);

  return null;
}
