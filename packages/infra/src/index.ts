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
export { InfrastructureEngine, modeIndex } from "./infrastructure-engine.ts";

export {
  CANARY_CONTROL_COMMAND_DESCRIPTORS,
  CanaryControlTuiModel,
  canaryCommandForHotkey,
  type CanaryControlCommandRow,
  type CanaryControlCommand,
  type CanaryControlTuiModelOptions,
  type CanaryControlPort,
  type CanaryControlPortResult,
  type CanaryControlPortStatus,
  type CanaryControlStatusRow,
  type CanaryControlTuiView,
  type CanaryLoopRunner,
} from "./canary-control-tui.ts";
