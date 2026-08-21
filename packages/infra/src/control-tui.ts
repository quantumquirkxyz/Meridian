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

export interface BetaControlCommandDescriptor extends BetaControlCommandRow {}

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

export interface BetaPaperLoopRunner {
  start(): void;
  stop(): void;
}

export interface BetaControlTuiModelOptions {
  loopRunner?: BetaPaperLoopRunner;
}

export const BETA_CONTROL_COMMAND_DESCRIPTORS: readonly BetaControlCommandDescriptor[] =
  [
    {
      command: "start",
      hotkey: "s",
      label: "Start paper loop",
      dangerous: false,
    },
    {
      command: "stop",
      hotkey: "x",
      label: "Stop paper loop",
      dangerous: false,
    },
    {
      command: "cancel-all",
      hotkey: "c",
      label: "Cancel all paper orders",
      dangerous: true,
    },
    {
      command: "cash-only",
      hotkey: "$",
      label: "Cash-only mode",
      dangerous: false,
    },
    {
      command: "reduce-only",
      hotkey: "r",
      label: "Reduce-only mode",
      dangerous: false,
    },
    {
      command: "halt",
      hotkey: "h",
      label: "Kill switch",
      dangerous: true,
    },
  ];

export function commandForHotkey(
  input: string,
): BetaControlCommand | undefined {
  return BETA_CONTROL_COMMAND_DESCRIPTORS.find((row) => row.hotkey === input)
    ?.command;
}

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
  return BETA_CONTROL_COMMANDS.map((command) => {
    const descriptor = BETA_CONTROL_COMMAND_DESCRIPTORS.find(
      (row) => row.command === command,
    );
    if (descriptor === undefined) {
      throw new Error(`missing descriptor for beta control command ${command}`);
    }
    return { ...descriptor };
  });
}

/**
 * Control model for a future Ink shell. It owns operator-visible state,
 * command labels, and error containment; trading state changes still flow only
 * through the deterministic control port.
 */
export class BetaControlTuiModel {
  private lastError: string | undefined;
  private readonly loopRunner: BetaPaperLoopRunner | undefined;

  constructor(
    private readonly session: BetaControlPort,
    options: BetaControlTuiModelOptions = {},
  ) {
    this.loopRunner = options.loopRunner;
  }

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
        "Hotkeys: s start, x stop, c cancel-all, r reduce-only, $ cash-only, h halt",
    };
  }

  dispatch(command: BetaControlCommand): BetaControlResult {
    try {
      const result = this.session.control(command);
      if (command === "start") {
        this.loopRunner?.start();
      } else if (command === "stop" || result.mode !== "PAPER_ONLY") {
        this.loopRunner?.stop();
      }
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
