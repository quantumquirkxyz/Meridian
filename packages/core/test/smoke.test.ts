import { describe, expect, test } from "bun:test";
import { CORE_VERSION } from "../src/index.ts";
import { isStateContext, parseDataQualityReport } from "@agenttrading/contracts";

describe("@agenttrading/core smoke", () => {
  test("package resolves and depends only on contracts", () => {
    expect(CORE_VERSION).toBe("0.1.0");
  });

  test("consumes shared contracts from the typed frontier", () => {
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
