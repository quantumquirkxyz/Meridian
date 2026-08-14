import { describe, expect, test } from "bun:test";
import { HARNESS_VERSION } from "../src/index.ts";
import { isOpportunityCandidate } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/harness smoke", () => {
  test("package resolves", () => {
    expectPackageSmoke(HARNESS_VERSION, () => {
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
});
