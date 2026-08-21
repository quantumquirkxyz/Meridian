import {
  isBoolean,
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isSystemMode, type SystemMode } from "./modes.ts";
import { isStateName, type StateName } from "./stategraph.ts";

/**
 * Gamma control-surface contract (issue #34). Extends the Beta control
 * vocabulary with live-canary-specific commands and status fields.
 *
 * The deterministic canary session and the operator UI both speak this
 * vocabulary, so commands live in contracts rather than being duplicated
 * across core and infra.
 *
 * Acceptance criteria (AC3):
 *   - Kill switch (manual and automatic) halts live activity.
 *   - Emergency modes (cancel-all, reduce-only, cash-only) available
 *     from the TUI.
 */

export const GAMMA_CONTROL_COMMANDS = [
  "start",
  "stop",
  "cancel-all",
  "cash-only",
  "reduce-only",
  "halt",
  // Gamma-specific canary commands
  "pause",
  "resume",
  "sync-inventory",
] as const;

export type GammaControlCommand = (typeof GAMMA_CONTROL_COMMANDS)[number];

/**
 * Live canary status snapshot. Extends Beta status with canary-specific
 * fields: capital deployed, limits hit, orphan detection, kill switch
 * details.
 */
export interface GammaControlStatus {
  /** Whether the canary session is running. */
  running: boolean;
  /** Current system mode. */
  mode: SystemMode;
  /** Current orchestrator state. */
  state: StateName;
  /** Whether the kill switch is currently active. */
  killSwitchActive: boolean;
  /** Number of live open orders. */
  openOrders: number;
  /** Number of orders placed today. */
  ordersToday: number;
  /** Number of orders placed this week. */
  ordersThisWeek: number;
  /** Total capital deployed (USD). */
  capitalDeployedUsd: number;
  /** Remaining capital in the canary bucket (USD). */
  capitalRemainingUsd: number;
  /** Daily PnL (USD). Negative = loss. */
  dailyPnlUsd: number;
  /** Weekly PnL (USD). Negative = loss. */
  weeklyPnlUsd: number;
  /** Number of orphan orders detected. */
  orphanOrderCount: number;
  /** Whether reconciliation is currently unresolved. */
  reconciliationUnresolved: boolean;
  /** Automatic kill switch trigger that fired, if any. */
  autoKillTrigger?: string;
  /** Whether the canary is paused (manual pause, not halt). */
  paused: boolean;
}

/**
 * Result of a gamma control command. Includes the command that was
 * executed plus the full status snapshot after the command.
 */
export interface GammaControlResult extends GammaControlStatus {
  command: GammaControlCommand;
  /** Whether the command succeeded. */
  ok: boolean;
  /** Human-readable error message if the command failed. */
  error?: string;
}

// ── Validators ───────────────────────────────────────────────────────

export const isGammaControlCommand: Validator<GammaControlCommand> =
  isEnumOf(GAMMA_CONTROL_COMMANDS);

export const isGammaControlStatus: Validator<GammaControlStatus> = isObjectOf({
  running: isBoolean,
  mode: isSystemMode,
  state: isStateName,
  killSwitchActive: isBoolean,
  openOrders: isNumber,
  ordersToday: isNumber,
  ordersThisWeek: isNumber,
  capitalDeployedUsd: isNumber,
  capitalRemainingUsd: isNumber,
  dailyPnlUsd: isNumber,
  weeklyPnlUsd: isNumber,
  orphanOrderCount: isNumber,
  reconciliationUnresolved: isBoolean,
  autoKillTrigger: isOptional(isString),
  paused: isBoolean,
});

export const isGammaControlResult: Validator<GammaControlResult> = isObjectOf({
  command: isGammaControlCommand,
  running: isBoolean,
  mode: isSystemMode,
  state: isStateName,
  killSwitchActive: isBoolean,
  openOrders: isNumber,
  ordersToday: isNumber,
  ordersThisWeek: isNumber,
  capitalDeployedUsd: isNumber,
  capitalRemainingUsd: isNumber,
  dailyPnlUsd: isNumber,
  weeklyPnlUsd: isNumber,
  orphanOrderCount: isNumber,
  reconciliationUnresolved: isBoolean,
  autoKillTrigger: isOptional(isString),
  paused: isBoolean,
  ok: isBoolean,
  error: isOptional(isString),
});

export function parseGammaControlCommand(value: unknown): GammaControlCommand {
  return parse(isGammaControlCommand, value, "GammaControlCommand");
}

/**
 * Port through which operator UIs control the Gamma canary session.
 * Lives in contracts so the wiring layer can import core to construct
 * the session while infra imports only this port type.
 */
export interface GammaControlPort {
  readonly status: GammaControlStatus;
  control(command: GammaControlCommand): GammaControlResult;
}

/**
 * Canonical hotkey-to-command mapping for the Gamma TUI. Both the text
 * renderer and the Ink input handler derive their bindings from this
 * single source.
 */
export const GAMMA_CONTROL_HOTKEYS = {
  start: "s",
  stop: "x",
  "cancel-all": "c",
  "cash-only": "$",
  "reduce-only": "r",
  halt: "h",
  pause: "p",
  resume: "u",
  "sync-inventory": "i",
} as const satisfies Record<GammaControlCommand, string>;
