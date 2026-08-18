/**
 * @agenttrading/infra — health checks, failover, circuit breakers, secrets,
 * control surface (TUI). Depends only on contracts.
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
