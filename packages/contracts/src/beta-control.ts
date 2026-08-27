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
  openOrders: number;
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
  openOrders: isNumber,
  reportCount: isNumber,
});

export const isBetaControlResult: Validator<BetaControlResult> = isObjectOf({
  command: isBetaControlCommand,
  running: isBoolean,
  mode: isSystemMode,
  state: isStateName,
  killSwitchActive: isBoolean,
  openOrders: isNumber,
  reportCount: isNumber,
});

export function parseBetaControlCommand(value: unknown): BetaControlCommand {
  return parse(isBetaControlCommand, value, "BetaControlCommand");
}

/**
 * Port through which operator UIs control the Beta session.
 * Lives in contracts so the wiring layer can import core to construct
 * the session while infra imports only this port type.
 */
export interface BetaControlPort {
  readonly status: BetaControlStatus;
  control(command: BetaControlCommand): BetaControlResult;
}

/**
 * Canonical hotkey-to-command mapping. Both the text renderer and the Ink
 * input handler derive their bindings from this single source.
 */
export const BETA_CONTROL_HOTKEYS = {
  start: "s",
  stop: "x",
  "cancel-all": "c",
  "cash-only": "$",
  "reduce-only": "r",
  halt: "h",
} as const satisfies Record<BetaControlCommand, string>;
