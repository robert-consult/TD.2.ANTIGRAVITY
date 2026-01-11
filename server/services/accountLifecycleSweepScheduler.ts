import { runInactivitySweep } from "./accountLifecycle";

let started = false;

export function startAccountLifecycleSweepScheduler() {
  if (started) return;
  started = true;

  const run = async () => {
    try {
      await runInactivitySweep({ dryRun: false, actorAdminId: null });
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

