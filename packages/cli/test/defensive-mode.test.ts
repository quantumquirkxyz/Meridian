import { describe, expect, test } from "bun:test";
import type { RiskDecisionOutcome } from "@agenttrading/contracts";
import {
  defensiveActionFor,
  isDefensiveOutcome,
} from "../src/defensive-mode.ts";

describe("defensiveActionFor (ADR-0003 mode transition)", () => {
  test("maps each defensive RiskDecisionOutcome to a control action", () => {
    expect(defensiveActionFor("HALT_SYSTEM")).toEqual({ kind: "control", command: "halt" });
    expect(defensiveActionFor("CASH_ONLY")).toEqual({ kind: "control", command: "cash-only" });
    expect(defensiveActionFor("EXIT_ONLY")).toEqual({ kind: "control", command: "reduce-only" });
    expect(defensiveActionFor("CANCEL_ONLY")).toEqual({ kind: "cancel-only" });
  });

  test("returns null for non-defensive outcomes", () => {
    expect(defensiveActionFor("APPROVE")).toBeNull();
    expect(defensiveActionFor("REJECT")).toBeNull();
    expect(defensiveActionFor("REDUCE_SIZE")).toBeNull();
  });

  test("isDefensiveOutcome flags exactly the defensive decision outcomes", () => {
    for (const o of ["HALT_SYSTEM", "CASH_ONLY", "EXIT_ONLY", "CANCEL_ONLY"] as const) {
      expect(isDefensiveOutcome(o)).toBe(true);
    }
    for (const o of ["APPROVE", "REJECT", "REDUCE_SIZE"] as const) {
      expect(isDefensiveOutcome(o)).toBe(false);
    }
  });
});
