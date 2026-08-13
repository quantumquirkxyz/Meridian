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
  "PAPER_ONLY",
  "CANCEL_ONLY",
  "REDUCE_ONLY",
  "CASH_ONLY",
  "HALT",
] as const;

export type SystemMode = (typeof SYSTEM_MODES)[number];

export const isSystemMode: Validator<SystemMode> = isEnumOf(SYSTEM_MODES);
