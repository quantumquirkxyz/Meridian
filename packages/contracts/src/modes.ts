import { isEnumOf, type Validator } from "./schema.ts";

/**
 * SystemMode: global permission state (CONTEXT.md glossary).
 * The system changes mode on failures or regime changes; modes can only reduce
 * activity, never increase it (fail closed, RISK.md).
 */
export const SYSTEM_MODES = [
  "NORMAL",
  "OBSERVE_ONLY",
  "SIGNAL_ONLY",
  "CANCEL_ONLY",
  "REDUCE_ONLY",
  "CASH_ONLY",
  "HALT",
] as const;

export type SystemMode = (typeof SYSTEM_MODES)[number];

export const isSystemMode: Validator<SystemMode> = isEnumOf(SYSTEM_MODES);

import type { RiskDecisionOutcome } from "./reason-codes.ts";

/**
 * mapRiskToMode: deterministic translation from RiskDecisionOutcome to SystemMode.
 *
 * CONTEXT.md "SystemMode" nomenclature rule (resolved 2026-08-27): the transition
 * from RiskDecisionOutcome to SystemMode must go through this explicit mapping,
 * never lexical inference. Only defensive outcomes produce a mode change.
 *
 * @throws Error for non-defensive outcomes (APPROVE, REJECT, REDUCE_SIZE) —
 *           risk decisions that do not dictate a mode change.
 */
export function mapRiskToMode(outcome: RiskDecisionOutcome): SystemMode {
  switch (outcome) {
    case "HALT_SYSTEM":
      return "HALT";
    case "CANCEL_ONLY":
      return "CANCEL_ONLY";
    case "CASH_ONLY":
      return "CASH_ONLY";
    case "EXIT_ONLY":
      return "REDUCE_ONLY";
    default:
      throw new Error(
        `mapRiskToMode: outcome "${outcome}" does not map to a SystemMode`,
      );
  }
}
