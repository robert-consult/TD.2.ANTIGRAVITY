import { describe, expect, it } from "vitest";
import {
  canonicalizeChallengeEvalIntervalInput,
  challengeEvalIntervalMinFromLegacySeconds,
  challengeEvalIntervalSecFromMinutes,
  resolveChallengeEvalInterval,
} from "@shared/challenges/systemConfig";

describe("challenge system config interval helpers", () => {
  it("treats minute-based interval as canonical", () => {
    expect(
      resolveChallengeEvalInterval({
        challengeEvalIntervalMin: 5,
        challengeEvaluationIntervalSec: 3600,
      }),
    ).toEqual({
      intervalMin: 5,
      intervalSec: 300,
      source: "minutes",
    });
  });

  it("converts legacy seconds to the next safe minute boundary", () => {
    expect(challengeEvalIntervalMinFromLegacySeconds(95)).toBe(2);
    expect(resolveChallengeEvalInterval({ challengeEvaluationIntervalSec: 95 })).toEqual({
      intervalMin: 2,
      intervalSec: 120,
      source: "legacy-seconds",
    });
  });

  it("accepts equivalent legacy seconds input without conflict", () => {
    expect(
      canonicalizeChallengeEvalIntervalInput({
        challengeEvalIntervalMin: 2,
        challengeEvaluationIntervalSec: 61,
      }),
    ).toEqual({
      intervalMin: 2,
      intervalSec: 120,
      source: "minutes",
      conflict: false,
    });
  });

  it("flags conflicting minute and second inputs", () => {
    expect(
      canonicalizeChallengeEvalIntervalInput({
        challengeEvalIntervalMin: 2,
        challengeEvaluationIntervalSec: 180,
      }),
    ).toEqual({
      intervalMin: 2,
      intervalSec: 120,
      source: "minutes",
      conflict: true,
    });
  });

  it("derives seconds directly from canonical minutes", () => {
    expect(challengeEvalIntervalSecFromMinutes(15)).toBe(900);
  });
});
