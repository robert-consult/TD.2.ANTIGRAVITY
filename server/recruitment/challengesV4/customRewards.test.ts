import { describe, expect, it } from "vitest";
import { parseCustomRewardRules, scopedCustomRewardKey } from "./customRewards";

describe("customRewards parser", () => {
  it("accepts only allow-listed triggers/actions", () => {
    const rules = parseCustomRewardRules([
      {
        id: "reward-1",
        trigger: "ON_CHALLENGE_PASS",
        actionType: "NOTIFY",
        payload: { title: "T", message: "M" },
      },
      {
        id: "reward-2",
        trigger: "ON_BAD_TRIGGER",
        actionType: "NOTIFY",
      },
      {
        id: "reward-3",
        trigger: "ON_ENROLL",
        actionType: "EXEC_JS",
      },
    ]);

    expect(rules).toHaveLength(1);
    expect(rules[0].trigger).toBe("ON_CHALLENGE_PASS");
    expect(rules[0].actionType).toBe("NOTIFY");
    expect(rules[0].rewardKey).toBe("reward-1");
  });

  it("hydrates rank trigger topN and payload aliases", () => {
    const rules = parseCustomRewardRules({
      rewards: [
        {
          key: "top3",
          trigger: "ON_RANK_TOP_N",
          action: "SELECTION_BOOST",
          points: 25,
          rankTopN: 3,
        },
      ],
    });

    expect(rules).toHaveLength(1);
    expect(rules[0].topN).toBe(3);
    expect(rules[0].payload.points).toBe(25);
  });

  it("builds phase-scoped reward keys for ON_PHASE_PASS", () => {
    const key = scopedCustomRewardKey({
      rewardKey: "phase-reward",
      trigger: "ON_PHASE_PASS",
      phaseNumber: 2,
    });
    expect(key).toBe("phase-reward:phase:2");
  });
});

