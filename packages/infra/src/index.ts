/**
 * @agenttrading/infra — health checks, failover, circuit breakers, secrets,
 * control surface (TUI), observability, and opportunity audit. Depends only
 * on contracts and events.
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
  BetaControlTuiModel,
  type BetaControlCommand,
  type BetaControlPort,
  type BetaControlPortResult,
  type BetaControlPortStatus,
} from "./control-tui.ts";
