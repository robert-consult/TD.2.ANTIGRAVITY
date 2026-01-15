import { runI18nWorkerTick } from "../server/i18n/worker";
import { getSummary } from "../server/i18n/service";

const maxRounds = Number(process.env.I18N_MAX_ROUNDS ?? 40);
const sleepMs = Number(process.env.I18N_SLEEP_MS ?? 500);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let lastPending: number | null = null;

  for (let i = 1; i <= maxRounds; i += 1) {
    const result = await runI18nWorkerTick();
    const summary = result.summary ?? (await getSummary());
    const pending = Number(summary.jobsPending ?? 0);
    const failed = Number(summary.jobsFailed ?? 0);
    const processed = Number((result as any).processed ?? 0);

    console.log(
      `[i18n-run] round ${i} processed=${processed} pending=${pending} failed=${failed}`,
    );

    if (pending === 0) break;
    if (processed === 0 && lastPending === pending) {
      console.log("[i18n-run] No progress detected; stopping.");
      break;
    }

    lastPending = pending;
    await sleep(sleepMs);
  }

  const finalSummary = await getSummary();
  console.log(
    `[i18n-run] done sources=${finalSummary.sources} translations=${finalSummary.translations} pending=${finalSummary.jobsPending} failed=${finalSummary.jobsFailed}`,
  );
}

main().catch((err) => {
  console.error("[i18n-run] failed:", err);
  process.exit(1);
});
