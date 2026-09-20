import { describe, expect, test } from "bun:test";
import { CORE_RISK_VERSION } from "@agenttrading/core-risk";
import { isStateContext, parseDataQualityReport } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/core-risk smoke", () => {
  test("package resolves and depends only on contracts", () => {
    expectPackageSmoke(CORE_RISK_VERSION, () => {
      const ctx = { state: "IDLE", mode: "NORMAL", updatedAtMs: 0 };
      expect(isStateContext(ctx)).toBe(true);

      const report = {
        source: "bybit-ws",
        state: "HEALTHY",
        score: 0.99,
        updatedAtMs: 0,
        lastSeenMs: 0,
      };
      expect(parseDataQualityReport(report).state).toBe("HEALTHY");
    });
  });
});
