import { describe, expect, test } from "bun:test";
import { HARNESS_VERSION } from "../src/index.ts";
import { isOpportunityCandidate } from "@agenttrading/contracts";

describe("@agenttrading/harness smoke", () => {
  test("package resolves", () => {
    expect(HARNESS_VERSION).toBe("0.1.0");
  });

  test("candidate shape comes from contracts", () => {
    const candidate = {
      id: "c1",
      snapshotId: "snap-1",
      route: ["a", "b"],
      grossSpreadUsd: 100,
      costs: {
        tradingFeesUsd: 10,
        slippageUsd: 5,
        gasUsd: 2,
        bridgeCostUsd: 0,
        fundingCostUsd: 0,
        latencyRiskUsd: 1,
        failureRiskUsd: 2,
        safetyBufferUsd: 10,
      },
      expectedNetProfitUsd: 70,
      createdAtMs: 0,
      status: "CANDIDATE",
      invalidationReasons: [],
    };
    expect(isOpportunityCandidate(candidate)).toBe(true);
  });
});
