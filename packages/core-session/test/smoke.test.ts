import { describe, expect, test } from "bun:test";
import { CORE_SESSION_VERSION } from "@agenttrading/core-session";
import { isStateContext, parseDataQualityReport } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/core-session smoke", () => {
  test("package resolves and depends only on contracts", () => {
    expectPackageSmoke(CORE_SESSION_VERSION, () => {
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
