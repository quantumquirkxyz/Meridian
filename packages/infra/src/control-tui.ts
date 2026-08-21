import {
  BETA_CONTROL_COMMANDS,
  type BetaControlCommand,
  type BetaControlResult,
  type BetaControlStatus,
} from "@agenttrading/contracts";

export type {
  BetaControlCommand,
  BetaControlResult as BetaControlPortResult,
  BetaControlStatus as BetaControlPortStatus,
} from "@agenttrading/contracts";

export interface BetaControlPort {
  readonly status: BetaControlStatus;
  control(command: BetaControlCommand): BetaControlResult;
}

export interface BetaControlCommandRow {
  command: BetaControlCommand;
  hotkey: string;
  label: string;
  dangerous: boolean;
}

export interface BetaControlStatusRow {
  label: string;
  value: string;
  emphasis: "normal" | "warning" | "danger";
}

export interface BetaControlTuiView {
  title: string;
  statusRows: readonly BetaControlStatusRow[];
  commandRows: readonly BetaControlCommandRow[];
  footer: string;
}

const COMMAND_LABELS: Record<BetaControlCommand, string> = {
  start: "Start paper loop",
  stop: "Stop paper loop",
  "cancel-all": "Cancel-only mode",
  "cash-only": "Cash-only mode",
  "reduce-only": "Reduce-only mode",
  halt: "Kill switch",
};

const COMMAND_HOTKEYS: Record<BetaControlCommand, string> = {
  start: "s",
  stop: "x",
  "cancel-all": "c",
  "cash-only": "$",
  "reduce-only": "r",
  halt: "h",
};

function modeEmphasis(
  status: BetaControlStatus,
): BetaControlStatusRow["emphasis"] {
  if (status.killSwitchActive || status.mode === "HALT") return "danger";
  if (status.mode !== "PAPER_ONLY") return "warning";
  return "normal";
}

function renderStatus(status: BetaControlStatus): BetaControlStatusRow[] {
  const mode = modeEmphasis(status);
  return [
    { label: "running", value: String(status.running), emphasis: "normal" },
    { label: "mode", value: status.mode, emphasis: mode },
    { label: "state", value: status.state, emphasis: mode },
    {
      label: "kill switch",
      value: status.killSwitchActive ? "active" : "inactive",
      emphasis: status.killSwitchActive ? "danger" : "normal",
    },
    {
      label: "open paper orders",
      value: String(status.openPaperOrders),
      emphasis: status.openPaperOrders > 0 ? "warning" : "normal",
    },
    {
      label: "reports",
      value: String(status.reportCount),
      emphasis: "normal",
    },
  ];
}

function renderCommands(): BetaControlCommandRow[] {
  return BETA_CONTROL_COMMANDS.map((command) => ({
    command,
    hotkey: COMMAND_HOTKEYS[command],
    label: COMMAND_LABELS[command],
    dangerous: command === "halt" || command === "cancel-all",
  }));
}

/**
 * Control model for a future Ink shell. It owns operator-visible state,
 * command labels, and error containment; trading state changes still flow only
 * through the deterministic control port.
 */
export class BetaControlTuiModel {
  private lastError: string | undefined;

  constructor(private readonly session: BetaControlPort) {}

  get status(): BetaControlStatus {
    return this.session.status;
  }

  get view(): BetaControlTuiView {
    return {
      title: "Meridian Beta Paper Control",
      statusRows: renderStatus(this.session.status),
      commandRows: renderCommands(),
      footer:
        this.lastError ??
        "Hotkeys: s start, x stop, c cancel-only, r reduce-only, $ cash-only, h halt",
    };
  }

  dispatch(command: BetaControlCommand): BetaControlResult {
    try {
      const result = this.session.control(command);
      this.lastError = undefined;
      return result;
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "unknown control error";
      throw error;
    }
  }

  render(): string {
    const view = this.view;
    const status = view.statusRows
      .map((row) => `${row.label}: ${row.value}`)
      .join("\n");
    const commands = view.commandRows
      .map((row) => `[${row.hotkey}] ${row.label}`)
      .join("  ");
    return `${view.title}\n${status}\n${commands}\n${view.footer}`;
  }
}
