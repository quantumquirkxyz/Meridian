/**
 * LiveRunner types — ADR-0011 unified demo/live runner configuration.
 *
 * Defines the config surface that AppConfig provides to the runner:
 * MODE=demo or MODE=live, Bybit endpoints, and canary limits for live.
 * The runner is the seam between the deterministic core (GammaSession,
 * ReconciliationEngine, AuditReconstructor) and the Bybit exchange API.
 */

import type { CanaryConfig } from "@agenttrading/contracts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";

/** Operating mode: demo validates integration; live runs with bounded capital. */
export type RunnerMode = "demo" | "live";

/** Bybit endpoint URLs selected by mode. */
export interface BybitEndpoints {
  restUrl: string;
  wsPublicUrl: string;
  wsPrivateUrl: string;
}

/** Known demo endpoints (Bybit Demo Trading). */
export const DEMO_ENDPOINTS: BybitEndpoints = {
  restUrl: "https://api-demo.bybit.com",
  wsPublicUrl: "wss://stream.bybit.com/v5/public/linear",
  wsPrivateUrl: "wss://stream-demo.bybit.com/v5/private",
};

/** Known live endpoints (Bybit mainnet). */
export const LIVE_ENDPOINTS: BybitEndpoints = {
  restUrl: "https://api.bybit.com",
  wsPublicUrl: "wss://stream.bybit.com/v5/public/linear",
  wsPrivateUrl: "wss://stream.bybit.com/v5/private",
};

/**
 * AppConfig-provided settings for LiveRunner.
 * The runner reads this once at construction and does not mutate it.
 */
export interface LiveRunnerConfig {
  /** Operating mode. Required. */
  mode: RunnerMode;
  /** Bybit API key. Required for both demo and live. */
  apiKey: string;
  /** Bybit API secret. Required for both demo and live. */
  apiSecret: string;
  /**
   * Override endpoints. Defaults to DEMO_ENDPOINTS or LIVE_ENDPOINTS based on mode.
   * Only override for testing or custom deployments.
   */
  endpoints?: BybitEndpoints;
  /**
   * Canary config. Only applies in `live` mode.
   * In `demo` mode, the runner uses a permissive policy to maximize
   * integration stress-testing (no real capital at risk).
   */
  canaryConfig?: CanaryConfig;
  /**
   * Symbols to subscribe to on the public market stream.
   * Defaults to ["BTCUSDT", "ETHUSDT"].
   */
  symbols?: string[];
}

/** Resolves endpoints for a given mode. */
export function resolveEndpoints(mode: RunnerMode, override?: BybitEndpoints): BybitEndpoints {
  return override ?? (mode === "demo" ? DEMO_ENDPOINTS : LIVE_ENDPOINTS);
}

/** Resolves the canary config for a given mode.
 *
 * In `demo`, returns a permissive config that bypasses capital limits
 * to maximize order throughput for integration testing.
 * In `live`, returns the provided canaryConfig or DEFAULT_CANARY_CONFIG.
 *
 * ADR-0011 rule: demo uses permissive regime policy (no real capital).
 */
export function resolveCanaryConfig(
  mode: RunnerMode,
  canaryConfig?: CanaryConfig,
): CanaryConfig {
  if (mode === "demo") {
    // Demo: bypass capital limits to exercise the full integration surface.
    // Risk rules (slippage, gas, latency, data quality) still apply.
    return {
      ...DEFAULT_CANARY_CONFIG,
      capitalLimits: {
        maxCapitalUsd: Infinity,
        maxRiskPerTradeUsd: Infinity,
        maxDailyLossUsd: Infinity,
        maxWeeklyLossUsd: Infinity,
      },
      maxOrderNotionalUsd: Infinity,
    };
  }
  return canaryConfig ?? DEFAULT_CANARY_CONFIG;
}
