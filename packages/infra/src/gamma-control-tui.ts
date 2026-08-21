import {
  GAMMA_CONTROL_COMMANDS,
  GAMMA_CONTROL_HOTKEYS,
  type GammaControlCommand,
  type GammaControlPort,
  type GammaControlResult,
  type GammaControlStatus,
} from "@agenttrading/contracts";

export type {
  GammaControlCommand,
  GammaControlPort,
  GammaControlResult as GammaControlPortResult,
  GammaControlStatus as GammaControlPortStatus,
} from "@agenttrading/contracts";

export interface GammaControlCommandRow {
  command: GammaControlCommand;
  hotkey: string;
  label: string;
  dangerous: boolean;
}

export interface GammaControlStatusRow {
  label: string;
  value: string;
  emphasis: "normal" | "warning" | "danger";
}

export interface GammaControlTuiView {
  title: string;
  statusRows: readonly GammaControlStatusRow[];
  commandRows: readonly GammaControlCommandRow[];
  footer: string;
}

export interface GammaPaperLoopRunner {
  start(): void;
  stop(): void;
}

export interface GammaControlTuiModelOptions {
  loopRunner?: GammaPaperLoopRunner;
}

const GAMMA_CONTROL_LABELS: Record<GammaControlCommand, string> = {
  start: "Start canary",
  stop: "Stop canary",
  "cancel-all": "Cancel all orders",
  "cash-only": "Cash-only mode",
  "reduce-only": "Reduce-only mode",
  halt: "Kill switch",
  pause: "Pause canary",
  resume: "Resume canary",
};

export const GAMMA_CONTROL_COMMAND_DESCRIPTORS: readonly GammaControlCommandRow[] =
  GAMMA_CONTROL_COMMANDS.map((command) => ({
    command,
    hotkey: GAMMA_CONTROL_HOTKEYS[command],
    label: GAMMA_CONTROL_LABELS[command],
    dangerous: command === "cancel-all" || command === "halt",
  }));

export function gammaCommandForHotkey(
  input: string,
): GammaControlCommand | undefined {
  return GAMMA_CONTROL_COMMAND_DESCRIPTORS.find((row) => row.hotkey === input)
    ?.command;
}

function gammaModeEmphasis(
  status: GammaControlStatus,
): GammaControlStatusRow["emphasis"] {
  if (status.killSwitchActive || status.mode === "HALT") return "danger";
  if (status.mode !== "NORMAL") return "warning";
  return "normal";
}

function renderGammaStatus(status: GammaControlStatus): GammaControlStatusRow[] {
  const mode = gammaModeEmphasis(status);
  const dailyLossWarning =
    status.dailyPnlUsd < 0 ? "warning" : "normal";
  const orphanDanger =
    status.orphanOrderCount > 0 ? "danger" : "normal";

  return [
    { label: "running", value: String(status.running), emphasis: "normal" },
    { label: "paused", value: String(status.paused), emphasis: status.paused ? "warning" : "normal" },
    { label: "mode", value: status.mode, emphasis: mode },
    { label: "state", value: status.state, emphasis: mode },
    {
      label: "kill switch",
      value: status.killSwitchActive ? "ACTIVE" : "inactive",
      emphasis: status.killSwitchActive ? "danger" : "normal",
    },
    {
      label: "auto-kill",
      value: status.autoKillTrigger ?? "none",
      emphasis: status.autoKillTrigger ? "danger" : "normal",
    },
    {
      label: "open orders",
      value: String(status.openOrders),
      emphasis: status.openOrders > 0 ? "warning" : "normal",
    },
    {
      label: "orders today",
      value: String(status.ordersToday),
      emphasis: "normal",
    },
    {
      label: "orders this week",
      value: String(status.ordersThisWeek),
      emphasis: "normal",
    },
    {
      label: "capital deployed",
      value: `$${status.capitalDeployedUsd.toFixed(2)}`,
      emphasis: status.capitalDeployedUsd > 0 ? "warning" : "normal",
    },
    {
      label: "capital remaining",
      value: `$${status.capitalRemainingUsd.toFixed(2)}`,
      emphasis: status.capitalRemainingUsd <= 0 ? "danger" : "normal",
    },
    {
      label: "daily PnL",
      value: `$${status.dailyPnlUsd.toFixed(2)}`,
      emphasis: dailyLossWarning,
    },
    {
      label: "weekly PnL",
      value: `$${status.weeklyPnlUsd.toFixed(2)}`,
      emphasis: status.weeklyPnlUsd < 0 ? "warning" : "normal",
    },
    {
      label: "orphan orders",
      value: String(status.orphanOrderCount),
      emphasis: orphanDanger,
    },
    {
      label: "reconciliation",
      value: status.reconciliationUnresolved ? "UNRESOLVED" : "ok",
      emphasis: status.reconciliationUnresolved ? "danger" : "normal",
    },
  ];
}

function renderGammaCommands(): GammaControlCommandRow[] {
  return [...GAMMA_CONTROL_COMMAND_DESCRIPTORS];
}

/**
 * Control model for the Gamma Live Canary TUI. It owns operator-visible
 * state, command labels, and error containment; trading state changes
 * still flow only through the deterministic control port.
 */
export class GammaControlTuiModel {
  private lastError: string | undefined;
  private readonly loopRunner: GammaPaperLoopRunner | undefined;

  constructor(
    private readonly session: GammaControlPort,
    options: GammaControlTuiModelOptions = {},
  ) {
    this.loopRunner = options.loopRunner;
  }

  get status(): GammaControlStatus {
    return this.session.status;
  }

  get view(): GammaControlTuiView {
    return {
      title: "Meridian Live Canary Control",
      statusRows: renderGammaStatus(this.session.status),
      commandRows: renderGammaCommands(),
      footer:
        this.lastError ??
        "Hotkeys: s start, x stop, c cancel-all, r reduce-only, $ cash-only, h halt, p pause, u resume",
    };
  }

  dispatch(command: GammaControlCommand): GammaControlResult {
    try {
      const result = this.session.control(command);
      if (command === "start") {
        this.loopRunner?.start();
      } else if (command === "stop" || result.mode === "HALT") {
        this.loopRunner?.stop();
      }
      this.lastError = result.ok ? undefined : result.error;
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
