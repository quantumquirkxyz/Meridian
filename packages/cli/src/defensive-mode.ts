import type { CanaryControlCommand, RiskDecisionOutcome } from "@agenttrading/contracts";

/**
 * Defensive risk decision outcomes that dictate a mode transition (ADR-0003,
 * CONTEXT.md §Risk Engine). A `HALT_SYSTEM` outcome is a risk dictamen — it
 * instructs the orchestrator to enter HALT; the Risk Engine itself never sets
 * `SystemMode` directly. This module translates a defensive `RiskDecisionOutcome`
 * into the orchestrator control action that applies the mode change.
 */

const DEFENSIVE_OUTCOMES: readonly Exclude<RiskDecisionOutcome, "APPROVE" | "REJECT" | "REDUCE_SIZE">[] = [
  "HALT_SYSTEM",
  "CASH_ONLY",
  "EXIT_ONLY",
  "CANCEL_ONLY",
];

export function isDefensiveOutcome(
  outcome: RiskDecisionOutcome,
): outcome is (typeof DEFENSIVE_OUTCOMES)[number] {
  return (DEFENSIVE_OUTCOMES as readonly RiskDecisionOutcome[]).includes(outcome);
}

/** A control command on the canary session (`halt` / `cash-only` / `reduce-only`). */
export type DefensiveControlAction = {
  kind: "control";
  command: Extract<CanaryControlCommand, "halt" | "cash-only" | "reduce-only">;
};

/** CANCEL_ONLY has no literal session command; enter defensive CANCEL_ONLY mode. */
export type DefensiveCancelOnlyAction = { kind: "cancel-only" };

export type DefensiveAction = DefensiveControlAction | DefensiveCancelOnlyAction;

/**
 * Translate a defensive `RiskDecisionOutcome` into the orchestrator action that
 * applies the corresponding mode reduction. Returns `null` for non-defensive
 * outcomes (there is no mode change to apply).
 */
export function defensiveActionFor(outcome: RiskDecisionOutcome): DefensiveAction | null {
  switch (outcome) {
    case "HALT_SYSTEM":
      return { kind: "control", command: "halt" };
    case "CASH_ONLY":
      return { kind: "control", command: "cash-only" };
    case "EXIT_ONLY":
      return { kind: "control", command: "reduce-only" };
    case "CANCEL_ONLY":
      return { kind: "cancel-only" };
    default:
      return null;
  }
}
