/**
 * @agenttrading/infra — health checks, failover, circuit breakers, secrets,
 * Ink control surface (TUI), observability, and opportunity audit. Runtime
 * dependencies are limited to contracts, events, ink, and react.
 */
export const INFRA_VERSION = "0.1.0";

export { DataQualityMonitor } from "./data-quality-monitor.ts";
export type {
  AlertCallback,
  DataQualityUpdateCallback,
  ReconnectCallback,
  StateChangeCallback,
  SourceTracking,
} from "./data-quality-monitor.ts";

export { OpportunityRecorder } from "./opportunity-recorder.ts";
export { ObservabilityService, OBSERVABILITY_SOURCE, OPPORTUNITY_RECORDER_SOURCE } from "./observability.ts";
export {
  BETA_CONTROL_COMMAND_DESCRIPTORS,
  BetaControlTuiModel,
  commandForHotkey,
  type BetaControlCommandRow,
  type BetaControlCommand,
  type BetaControlTuiModelOptions,
  type BetaControlPort,
  type BetaControlPortResult,
  type BetaControlPortStatus,
  type BetaControlStatusRow,
  type BetaControlTuiView,
  type BetaPaperLoopRunner,
} from "./control-tui.ts";
export {
  BetaControlInkTui,
  type BetaControlInkTuiProps,
} from "./control-tui-ink.tsx";
