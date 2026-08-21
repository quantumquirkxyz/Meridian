import { type SystemMode, type StateName } from "@agenttrading/contracts";

export type BetaControlCommand =
  | "start"
  | "stop"
  | "cancel-all"
  | "cash-only"
  | "reduce-only"
  | "halt";

export interface BetaControlPortStatus {
  running: boolean;
  mode: SystemMode;
  state: StateName;
  killSwitchActive: boolean;
  openPaperOrders: number;
  reportCount: number;
}

export interface BetaControlPortResult extends BetaControlPortStatus {
  command: BetaControlCommand;
}

export interface BetaControlPort {
  readonly status: BetaControlPortStatus;
  control(command: BetaControlCommand): BetaControlPortResult;
}

/**
 * Minimal command model for an Ink control TUI. It deliberately targets a port
 * instead of importing core, so terminal rendering never owns trading logic.
 */
export class BetaControlTuiModel {
  constructor(private readonly session: BetaControlPort) {}

  get status(): BetaControlPortStatus {
    return this.session.status;
  }

  dispatch(command: BetaControlCommand): BetaControlPortResult {
    return this.session.control(command);
  }
}
