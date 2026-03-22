// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getSystemChallengeConfig: vi.fn(),
}));

vi.mock("../../recruitment/challengesV4/challengeConfig", () => ({
  getSystemChallengeConfig: state.getSystemChallengeConfig,
  buildChallengeSchedulerRuntimeConfig: (source: any) => ({
    enabled: Boolean(source?.challengeEvalEnabled ?? true),
    intervalMin: Number(source?.challengeEvalIntervalMin ?? 60),
    intervalSec: Number(source?.challengeEvaluationIntervalSec ?? Number(source?.challengeEvalIntervalMin ?? 60) * 60),
    maxRows: Number(source?.challengeEvalMaxRows ?? 500),
  }),
}));

describe("challenge scheduler runtime config", () => {
  const originalEnabled = process.env.CHALLENGE_EVAL_ENABLED;
  const originalInterval = process.env.CHALLENGE_EVAL_INTERVAL_MINUTES;
  const originalMaxRows = process.env.CHALLENGE_EVAL_MAX_ROWS;
  const originalStartDelay = process.env.CHALLENGE_EVAL_START_DELAY_SEC;
  const originalDisabledPoll = process.env.CHALLENGE_EVAL_DISABLED_POLL_SEC;

  beforeEach(() => {
    vi.resetModules();
    state.getSystemChallengeConfig.mockReset();
    process.env.CHALLENGE_EVAL_ENABLED = "1";
    process.env.CHALLENGE_EVAL_INTERVAL_MINUTES = "60";
    process.env.CHALLENGE_EVAL_MAX_ROWS = "500";
    process.env.CHALLENGE_EVAL_START_DELAY_SEC = "120";
    process.env.CHALLENGE_EVAL_DISABLED_POLL_SEC = "60";
  });

  afterEach(() => {
    process.env.CHALLENGE_EVAL_ENABLED = originalEnabled;
    process.env.CHALLENGE_EVAL_INTERVAL_MINUTES = originalInterval;
    process.env.CHALLENGE_EVAL_MAX_ROWS = originalMaxRows;
    process.env.CHALLENGE_EVAL_START_DELAY_SEC = originalStartDelay;
    process.env.CHALLENGE_EVAL_DISABLED_POLL_SEC = originalDisabledPoll;
  });

  it("falls back to environment-owned disabled state when the deploy kill switch is set", async () => {
    process.env.CHALLENGE_EVAL_ENABLED = "0";
    const { getChallengeSchedulerEffectiveState } = await import("./challengeScheduler");
    const state = await getChallengeSchedulerEffectiveState();

    expect(state.runtime).toMatchObject({
      enabled: false,
      intervalMin: 60,
      intervalSec: 3600,
      maxRows: 500,
      source: "ENV",
    });
  });

  it("uses the DB-backed runtime cadence when the deploy switch allows it", async () => {
    state.getSystemChallengeConfig.mockResolvedValue({
      challengeEvalEnabled: true,
      challengeEvalIntervalMin: 7,
      challengeEvaluationIntervalSec: 420,
      challengeEvalMaxRows: 321,
    });

    const { getChallengeSchedulerEffectiveState } = await import("./challengeScheduler");
    const stateValue = await getChallengeSchedulerEffectiveState();

    expect(stateValue.runtime).toEqual({
      enabled: true,
      intervalMin: 7,
      intervalSec: 420,
      maxRows: 321,
      source: "DB",
    });
    expect(stateValue.deployGuards.startDelaySec).toBe(120);
    expect(stateValue.deployGuards.disabledPollSec).toBe(60);
  });
});
