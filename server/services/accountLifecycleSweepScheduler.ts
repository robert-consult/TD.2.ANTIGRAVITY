import { runInactivitySweep } from "./accountLifecycle";
import { purgeExpiredRememberMeTokens } from "./rememberMe";

let started = false;

export function startAccountLifecycleSweepScheduler() {
  if (started) return;
  started = true;

  const run = async () => {
    try {
      const sweep = await runInactivitySweep({ dryRun: false, actorAdminId: null });
      const purgedRememberMeTokens = await purgeExpiredRememberMeTokens();
      console.info("[AccountLifecycle] Sweep complete", {
        foundInactive: sweep.foundInactive,
        foundDue: sweep.foundDue,
        autoQueueInactive: sweep.autoQueueInactive,
        autoSoftDelete: sweep.autoSoftDelete,
        purgedRememberMeTokens,
      });
    } catch (e) {
      console.error("[AccountLifecycle] Sweep failed:", e);
    }
  };

  // First run after 3 minutes to avoid slowing boot
  setTimeout(() => {
    void run();
  }, 3 * 60 * 1000);

  // Then every 24h
  setInterval(() => {
    void run();
  }, 24 * 60 * 60 * 1000);
}
