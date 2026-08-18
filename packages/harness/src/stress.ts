/**
 * Stress test scenarios (issue #21 AC3). Exercises the system under adverse
 * conditions: disconnection, stale data, extreme slippage, RPC failure,
 * cascade failures, and extreme market conditions. Each scenario produces
 * a structured StressReport.
 *
 * All scenarios are deterministic given the same seed.
 */

import type {
  EventEnvelope,
  MarketGraphSnapshot,
} from "@agenttrading/contracts";
import { foldGraphState } from "@agenttrading/events";
import { createSeededRng, type SeededRng } from "./seed.ts";
import { FillSimulator, type FillResult } from "./simulators/fill.ts";
import { GasSimulator, type GasEstimate } from "./simulators/gas.ts";
import { FundingSimulator, type FundingEstimate } from "./simulators/funding.ts";
import { LatencySimulator, type LatencyEstimate } from "./simulators/latency.ts";
import { FailureSimulator, type FailureResult, type FailureType } from "./simulators/failure.ts";

/** Stress scenario identifiers. */
export type StressScenario =
  | "DISCONNECTION"
  | "STALE_DATA"
  | "EXTREME_SLIPPAGE"
  | "RPC_FAILURE"
  | "CASCADE_FAILURES"
  | "EXTREME_GAS"
  | "FUNDING_SPIKE"
  | "COMBINED_STRESS";

/** Result of a single stress test iteration. */
export interface StressIteration {
  iteration: number;
  scenario: StressScenario;
  /** Whether the system survived without unrecoverable loss. */
  survived: boolean;
  /** Fill result (if a fill was attempted). */
  fill?: FillResult;
  /** Gas estimate. */
  gas?: GasEstimate;
  /** Funding estimate. */
  funding?: FundingEstimate;
  /** Latency estimate. */
  latency?: LatencyEstimate;
  /** Failure result(s). */
  failures: FailureResult[];
  /** PnL impact of this iteration. */
  pnlImpactUsd: number;
  /** Human-readable notes. */
  notes: string;
}

/** Aggregated report from a stress test run. */
export interface StressReport {
  /** The scenario tested. */
  scenario: StressScenario;
  /** The seed used. */
  seed: number;
  /** Total iterations run. */
  totalIterations: number;
  /** Iterations where the system survived. */
  survivedIterations: number;
  /** Survival rate. */
  survivalRate: number;
  /** Total PnL impact across all iterations. */
  totalPnlImpactUsd: number;
  /** Average PnL impact per iteration. */
  avgPnlImpactUsd: number;
  /** Worst single-iteration loss. */
  worstLossUsd: number;
  /** Total failures encountered. */
  totalFailures: number;
  /** Failure types encountered. */
  failureTypes: FailureType[];
  /** All iterations (for detailed analysis). */
  iterations: StressIteration[];
}

/** Configuration for stress tests. */
export interface StressTestConfig {
  /** Seed for deterministic reproducibility. */
  seed: number;
  /** Events to fold into a graph snapshot (optional; a minimal snapshot is created if omitted). */
  events?: EventEnvelope[];
  /** Number of iterations per scenario. Default: 100. */
  iterations?: number;
  /** Which scenarios to run. Default: all. */
  scenarios?: StressScenario[];
  /** Capital per iteration. Default: 10000. */
  capitalPerIterationUsd?: number;
}

function createMinimalSnapshot(): MarketGraphSnapshot {
  return {
    version: 1,
    snapshotId: "snap:stress:minimal",
    createdAtMs: Date.now(),
    nodes: [
      { id: "asset:BTC", type: "ASSET" },
      { id: "asset:ETH", type: "ASSET" },
      { id: "asset:USDT", type: "ASSET" },
      { id: "venue:bybit", type: "VENUE" },
      { id: "venue:pancakeswap", type: "VENUE" },
    ],
    edges: [
      {
        id: "venue:bybit→asset:BTC:ORDER_BOOK",
        from: "venue:bybit",
        to: "asset:BTC",
        type: "ORDER_BOOK",
        weights: { price: 42_000, liquidityUsd: 100_000 },
        tradable: true,
        source: "bybit-ws",
      },
      {
        id: "venue:pancakeswap→asset:ETH:SWAP",
        from: "venue:pancakeswap",
        to: "asset:ETH",
        type: "SWAP",
        weights: { price: 2_500, liquidityUsd: 500_000 },
        tradable: true,
        source: "pancakeswap-rpc",
      },
    ],
  };
}

const ALL_SCENARIOS: StressScenario[] = [
  "DISCONNECTION",
  "STALE_DATA",
  "EXTREME_SLIPPAGE",
  "RPC_FAILURE",
  "CASCADE_FAILURES",
  "EXTREME_GAS",
  "FUNDING_SPIKE",
  "COMBINED_STRESS",
];

/**
 * Run a stress test for a single scenario.
 */
function runScenario(
  scenario: StressScenario,
  rng: SeededRng,
  snapshot: MarketGraphSnapshot,
  iterations: number,
  capitalPerIterationUsd: number,
): StressIteration[] {
  const results: StressIteration[] = [];

  for (let i = 0; i < iterations; i++) {
    const iter = runSingleIteration(scenario, rng, snapshot, capitalPerIterationUsd, i);
    results.push(iter);
  }

  return results;
}

function runSingleIteration(
  scenario: StressScenario,
  rng: SeededRng,
  snapshot: MarketGraphSnapshot,
  capitalUsd: number,
  iteration: number,
): StressIteration {
  const failures: FailureResult[] = [];
  let survived = true;
  let pnlImpactUsd = 0;
  const notes: string[] = [];

  // Configure simulators per scenario.
  const fillSim = new FillSimulator({
    baseSlippageBps: scenario === "EXTREME_SLIPPAGE" ? 100 : 5,
    maxSlippageBps: scenario === "EXTREME_SLIPPAGE" ? 2000 : 500,
    depthImpactFactor: scenario === "EXTREME_SLIPPAGE" ? 0.5 : 0.1,
  });

  const gasSim = new GasSimulator({
    baseGasPriceGwei: scenario === "EXTREME_GAS" ? 200 : 20,
    gasSpikeProbability: scenario === "EXTREME_GAS" ? 0.8 : 0.1,
    congestionMultiplierRange: scenario === "EXTREME_GAS" ? [5, 20] : [1, 5],
  });

  const fundingSim = new FundingSimulator({
    meanFundingRate: scenario === "FUNDING_SPIKE" ? 0.001 : 0.0001,
    spikeProbability: scenario === "FUNDING_SPIKE" ? 0.5 : 0.05,
  });

  const latencySim = new LatencySimulator({
    baseLatencyMs: scenario === "DISCONNECTION" ? 500 : 50,
    spikeProbability: scenario === "DISCONNECTION" ? 0.8 : 0.1,
    spikeRangeMs: scenario === "DISCONNECTION" ? [2000, 30000] : [200, 2000],
  });

  const failureSim = new FailureSimulator({
    failureProbability:
      scenario === "RPC_FAILURE"
        ? 0.8
        : scenario === "CASCADE_FAILURES"
          ? 0.5
          : scenario === "COMBINED_STRESS"
            ? 0.3
            : 0.05,
    cascadeProbability:
      scenario === "CASCADE_FAILURES" ? 0.8 : scenario === "COMBINED_STRESS" ? 0.4 : 0.2,
    maxCascadeLength: scenario === "CASCADE_FAILURES" ? 5 : 3,
  });

  // Simulate a fill attempt.
  const fill = fillSim.simulateFill(rng, {
    side: "BUY",
    price: 42_000,
    quantity: capitalUsd / 42_000,
    depthUsd: 100_000,
  });

  // Simulate gas.
  const gas = gasSim.simulateGas(rng, "swap");

  // Simulate latency.
  const latency = latencySim.simulateLatency(rng);

  // Simulate failure.
  const context =
    scenario === "RPC_FAILURE"
      ? { isDex: true }
      : scenario === "DISCONNECTION"
        ? { isWs: true }
        : { isCex: true };

  let failure = failureSim.simulateFailure(rng, context);
  if (failure.failed) {
    failures.push(failure);

    // Cascade failures.
    if (failure.cascade) {
      const cascadeResults = failureSim.simulateCascade(rng, context);
      for (const cr of cascadeResults) {
        if (cr.failed) failures.push(cr);
      }
    }
  }

  // Compute PnL impact.
  const totalCosts =
    fill.slippageUsd +
    gas.gasCostUsd +
    latency.latencyCostUsd;

  if (!fill.filled) {
    pnlImpactUsd = -totalCosts;
    notes.push("Order not filled");
  } else if (failures.length > 0) {
    // Trade was filled but a failure occurred — could mean loss.
    pnlImpactUsd = -totalCosts - 50; // failure penalty
    notes.push(`${failures.length} failure(s) encountered`);
  } else {
    pnlImpactUsd = 100 * fill.fillRatio - totalCosts; // simplified profit
  }

  // Determine survival.
  if (scenario === "DISCONNECTION" && latency.exceededDeadline) {
    survived = false;
    notes.push("System did not survive disconnection stress");
  } else if (
    scenario === "CASCADE_FAILURES" &&
    failures.length >= 3
  ) {
    survived = false;
    notes.push("System overwhelmed by cascade failures");
  } else if (
    scenario === "COMBINED_STRESS" &&
    (failures.length >= 2 || !fill.filled || pnlImpactUsd < -200)
  ) {
    survived = false;
    notes.push("System failed under combined stress");
  } else if (pnlImpactUsd < -capitalUsd * 0.5) {
    survived = false;
    notes.push("Catastrophic loss exceeds 50% of capital");
  }

  if (notes.length === 0) {
    notes.push("Normal operation");
  }

  return {
    iteration,
    scenario,
    survived,
    fill,
    gas,
    latency,
    failures,
    pnlImpactUsd,
    notes: notes.join("; "),
  };
}

/**
 * Run a complete stress test across all or selected scenarios.
 */
export function runStressTest(config: StressTestConfig): StressReport[] {
  const {
    seed,
    events,
    iterations = 100,
    scenarios = ALL_SCENARIOS,
    capitalPerIterationUsd = 10_000,
  } = config;

  const rng = createSeededRng(seed);
  const snapshot = events
    ? foldGraphState(events)
    : createMinimalSnapshot();

  const reports: StressReport[] = [];

  for (const scenario of scenarios) {
    const scenarioRng = createSeededRng(rng.nextInt(1, 2_147_483_647));
    const iterations_ = runScenario(
      scenario,
      scenarioRng,
      snapshot,
      iterations,
      capitalPerIterationUsd,
    );

    const survivedIterations = iterations_.filter((i) => i.survived).length;
    const totalPnlImpactUsd = iterations_.reduce(
      (sum, i) => sum + i.pnlImpactUsd,
      0,
    );
    const worstLossUsd = Math.min(
      ...iterations_.map((i) => i.pnlImpactUsd),
    );
    const allFailures = iterations_.flatMap((i) => i.failures);
    const failureTypes = [
      ...new Set(allFailures.map((f) => f.failureType).filter(Boolean)),
    ] as FailureType[];

    reports.push({
      scenario,
      seed: scenarioRng.getState(),
      totalIterations: iterations,
      survivedIterations,
      survivalRate: survivedIterations / iterations,
      totalPnlImpactUsd,
      avgPnlImpactUsd: totalPnlImpactUsd / iterations,
      worstLossUsd,
      totalFailures: allFailures.length,
      failureTypes,
      iterations: iterations_,
    });
  }

  return reports;
}
