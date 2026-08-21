import {
  isBoolean,
  isEnumOf,
  isNumber,
  isObjectOf,
  parse,
  type Validator,
} from "./schema.ts";
import { isSystemMode, type SystemMode } from "./modes.ts";
import { isStateName, type StateName } from "./stategraph.ts";

/**
 * Shared Beta control-surface contract. The deterministic session and the
 * operator UI both speak this vocabulary, so commands live in contracts rather
 * than being duplicated across core and infra.
 */
export const BETA_CONTROL_COMMANDS = [
  "start",
  "stop",
  "cancel-all",
  "cash-only",
  "reduce-only",
  "halt",
] as const;

export type BetaControlCommand = (typeof BETA_CONTROL_COMMANDS)[number];

export interface BetaControlStatus {
  running: boolean;
  mode: SystemMode;
  state: StateName;
  killSwitchActive: boolean;
  openPaperOrders: number;
  reportCount: number;
}

export interface BetaControlResult extends BetaControlStatus {
  command: BetaControlCommand;
}

export const isBetaControlCommand: Validator<BetaControlCommand> = isEnumOf(
  BETA_CONTROL_COMMANDS,
);

export const isBetaControlStatus: Validator<BetaControlStatus> = isObjectOf({
  running: isBoolean,
  mode: isSystemMode,
  state: isStateName,
  killSwitchActive: isBoolean,
  openPaperOrders: isNumber,
  reportCount: isNumber,
});

export const isBetaControlResult: Validator<BetaControlResult> = isObjectOf({
  command: isBetaControlCommand,
  running: isBoolean,
  mode: isSystemMode,
  state: isStateName,
  killSwitchActive: isBoolean,
  openPaperOrders: isNumber,
  reportCount: isNumber,
});

export function parseBetaControlCommand(value: unknown): BetaControlCommand {
  return parse(isBetaControlCommand, value, "BetaControlCommand");
}
