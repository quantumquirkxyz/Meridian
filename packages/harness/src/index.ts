/**
 * @agenttrading/harness — reproducible evaluation: backtest, event replay,
 * fill/slippage/gas/latency simulators, stress tests, performance reports.
 * Depends only on contracts, graph, and events.
 */
export const HARNESS_VERSION = "0.1.0";

// ── PRNG ──────────────────────────────────────────────────────────
export { createSeededRng, type SeededRng } from "./seed.ts";

// ── Simulators ────────────────────────────────────────────────────
export {
  FillSimulator,
  type FillResult,
  type FillSimulatorOptions,
} from "./simulators/fill.ts";

export {
  GasSimulator,
  type GasEstimate,
  type GasSimulatorOptions,
} from "./simulators/gas.ts";

export {
  FundingSimulator,
  type FundingEstimate,
  type FundingSimulatorOptions,
} from "./simulators/funding.ts";

export {
  LatencySimulator,
  type LatencyEstimate,
  type LatencySimulatorOptions,
} from "./simulators/latency.ts";

export {
  FailureSimulator,
  type FailureResult,
  type FailureType,
  type FailureSimulatorOptions,
} from "./simulators/failure.ts";

// ── Backtest ──────────────────────────────────────────────────────
export {
  BacktestRunner,
  type BacktestTrade,
  type BacktestConfig,
  type BacktestResult,
} from "./backtest.ts";

// ── Stress ────────────────────────────────────────────────────────
export {
  runStressTest,
  type StressScenario,
  type StressIteration,
  type StressReport,
  type StressTestConfig,
} from "./stress.ts";

// ── Performance Report ────────────────────────────────────────────
export {
  computePerformanceReport,
  type PerformanceReport,
} from "./report.ts";
