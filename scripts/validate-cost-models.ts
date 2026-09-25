#!/usr/bin/env bun
/**
 * validate-cost-models.ts
 *
 * Validates the system's cost estimates (slippage, gas, latency, failure)
 * against simulated exchange behavior before live trading.
 *
 * For each scenario:
 *   1. Build a MarketGraphSnapshot with specific edge weights (system estimates)
 *   2. Run computeRouteCost to get the system's estimated costs
 *   3. Run simulators to get actual costs
 *   4. Compare each cost component
 *   5. Report discrepancies where deviation exceeds the configurable threshold
 *
 * Exit 0 if all scenarios pass, 1 if any fail.
 */

import { createSeededRng } from "../packages/harness/src/seed.ts";
import { FillSimulator, type FillSimulatorOptions } from "../packages/harness/src/simulators/fill.ts";
import { GasSimulator, type GasSimulatorOptions } from "../packages/harness/src/simulators/gas.ts";
import { LatencySimulator, type LatencySimulatorOptions } from "../packages/harness/src/simulators/latency.ts";
import { FailureSimulator } from "../packages/harness/src/simulators/failure.ts";
import { computeRouteCost, type Route } from "../packages/graph/src/pathfinding.ts";
import type {
  MarketGraphSnapshot,
  MarketNode,
  MarketEdge,
  EdgeWeights,
} from "../packages/contracts/src";

const DEFAULT_THRESHOLD_PCT = 20;
const RNG_SEED = 42;
const FAILURE_TRIALS = 200;

interface CostValidationResult {
  scenario: string;
  component: string;
  estimated: number;
  actual: number;
  deviationPct: number;
  passed: boolean;
}

interface Scenario {
  name: string;
  description: string;
  route: Route;
  snapshot: MarketGraphSnapshot;
  fillParams: {
    side: "BUY" | "SELL";
    price: number;
    quantity: number;
    depthUsd: number;
    spreadBps?: number;
  };
  gasType: "swap" | "bridge" | "custom";
  gasPriceGwei?: number;
  latencyDeadlineMs?: number;
  edgeFailureProbabilities: number[];
  fillOptions?: FillSimulatorOptions;
  gasOptions?: GasSimulatorOptions;
  latencyOptions?: LatencySimulatorOptions;
  costOptions?: Parameters<typeof computeRouteCost>[2];
}

function buildNode(id: string, type: MarketNode["type"] = "ASSET"): MarketNode {
  return { id, type };
}

function buildEdge(
  id: string,
  from: string,
  to: string,
  type: MarketEdge["type"],
  weights: EdgeWeights,
): MarketEdge {
  return {
    id,
    from,
    to,
    type,
    weights,
    tradable: true,
    source: "validate-cost-models",
  };
}

function computeDeviation(estimated: number, actual: number): number {
  if (actual === 0) {
    return estimated > 0 ? Infinity : 0;
  }
  return Math.abs(estimated - actual) / actual * 100;
}

function runScenario(scenario: Scenario, thresholdPct: number): CostValidationResult[] {
  const routeCost = computeRouteCost(
    scenario.snapshot,
    scenario.route,
    scenario.costOptions,
  );

  const rng = createSeededRng(RNG_SEED);

  const fillSim = new FillSimulator(scenario.fillOptions);
  const fill = fillSim.simulateFill(rng, scenario.fillParams);

  const gasSim = new GasSimulator(scenario.gasOptions);
  const gas = gasSim.simulateGas(
    rng,
    scenario.gasType,
    scenario.gasPriceGwei,
  );

  const latencySim = new LatencySimulator(scenario.latencyOptions);
  const latency = latencySim.simulateLatency(
    rng,
    scenario.latencyDeadlineMs,
  );

  let failures = 0;
  const failureRng = createSeededRng(RNG_SEED + 9999);
  for (let i = 0; i < FAILURE_TRIALS; i++) {
    let trialFailed = false;
    for (const prob of scenario.edgeFailureProbabilities) {
      const failureSim = new FailureSimulator({ failureProbability: prob });
      if (failureSim.simulateFailure(failureRng).failed) {
        trialFailed = true;
        break;
      }
    }
    if (trialFailed) failures++;
  }
  const empiricalFailureRate = failures / FAILURE_TRIALS;

  const results: CostValidationResult[] = [
    {
      scenario: scenario.name,
      component: "slippage",
      estimated: routeCost.costs.slippageUsd,
      actual: fill.slippageUsd,
      deviationPct: computeDeviation(routeCost.costs.slippageUsd, fill.slippageUsd),
      passed: computeDeviation(routeCost.costs.slippageUsd, fill.slippageUsd) <= thresholdPct,
    },
    {
      scenario: scenario.name,
      component: "gas",
      estimated: routeCost.costs.gasUsd,
      actual: gas.gasCostUsd,
      deviationPct: computeDeviation(routeCost.costs.gasUsd, gas.gasCostUsd),
      passed: computeDeviation(routeCost.costs.gasUsd, gas.gasCostUsd) <= thresholdPct,
    },
    {
      scenario: scenario.name,
      component: "latency",
      estimated: routeCost.costs.latencyRiskUsd,
      actual: latency.latencyCostUsd,
      deviationPct: computeDeviation(routeCost.costs.latencyRiskUsd, latency.latencyCostUsd),
      passed: computeDeviation(routeCost.costs.latencyRiskUsd, latency.latencyCostUsd) <= thresholdPct,
    },
    {
      scenario: scenario.name,
      component: "failure-probability",
      estimated: routeCost.combinedFailureProbability,
      actual: empiricalFailureRate,
      deviationPct: computeDeviation(routeCost.combinedFailureProbability, empiricalFailureRate),
      passed: computeDeviation(routeCost.combinedFailureProbability, empiricalFailureRate) <= thresholdPct,
    },
  ];

  return results;
}

function printResult(result: CostValidationResult): void {
  const status = result.passed ? "PASS" : "FAIL";
  const icon = result.passed ? "✓" : "✗";
  console.log(
    `  ${icon} [${status}] ${result.scenario} / ${result.component}: ` +
    `estimated=${result.estimated.toFixed(4)} actual=${result.actual.toFixed(4)} ` +
    `deviation=${result.deviationPct.toFixed(2)}%`,
  );
}

function main(): void {
  const thresholdPct = Number(process.env.COST_VALIDATION_THRESHOLD_PCT) || DEFAULT_THRESHOLD_PCT;

  const scenarios: Scenario[] = [
    {
      name: "small-order-deep-book",
      description: "Small order in a deep order book",
      route: ["A", "B"],
      snapshot: {
        version: 1,
        snapshotId: "snap-small-deep",
        createdAtMs: Date.now(),
        nodes: [buildNode("A"), buildNode("B")],
        edges: [
          buildEdge("edge-1", "A", "B", "ORDER_BOOK", {
            price: 100,
            fee: 0.1,
            expectedSlippage: 0.6013,
            gasCost: 7.5,
            latencyMs: 55,
            liquidityUsd: 1_000_000,
            failureProbability: 0.01,
          }),
        ],
      },
      fillParams: {
        side: "BUY",
        price: 100,
        quantity: 10,
        depthUsd: 1_000_000,
      },
      gasType: "swap",
      gasOptions: {
        congestionMultiplierRange: [1, 1],
        gasSpikeProbability: 0,
      },
      latencyOptions: {
        baseLatencyMs: 50,
        jitterRangeMs: [5, 5],
        spikeProbability: 0,
        spikeRangeMs: [200, 2000],
        latencyCostPerMs: 0.001,
      },
      edgeFailureProbabilities: [0.01],
    },
    {
      name: "dex-swap-varying-gas",
      description: "DEX swap with varying gas prices",
      route: ["A", "B"],
      snapshot: {
        version: 1,
        snapshotId: "snap-dex-swap",
        createdAtMs: Date.now(),
        nodes: [buildNode("A"), buildNode("B")],
        edges: [
          buildEdge("edge-1", "A", "B", "SWAP", {
            price: 100,
            expectedSlippage: 1.994,
            gasCost: 7.5,
            latencyMs: 105,
            liquidityUsd: 500_000,
            failureProbability: 0.03,
          }),
        ],
      },
      fillParams: {
        side: "BUY",
        price: 100,
        quantity: 10,
        depthUsd: 500_000,
      },
      gasType: "swap",
      gasOptions: {
        congestionMultiplierRange: [1, 1],
        gasSpikeProbability: 0,
      },
      latencyOptions: {
        baseLatencyMs: 100,
        jitterRangeMs: [5, 5],
        spikeProbability: 0,
        spikeRangeMs: [200, 2000],
        latencyCostPerMs: 0.001,
      },
      fillOptions: {
        venueModel: "dex",
        ammReserveQuote: 500_000,
        ammFeeBps: 30,
      },
      edgeFailureProbabilities: [0.03],
    },
    {
      name: "cross-venue-arbitrage",
      description: "Cross-venue arbitrage with bridge",
      route: ["A", "B"],
      snapshot: {
        version: 1,
        snapshotId: "snap-cross-venue",
        createdAtMs: Date.now(),
        nodes: [buildNode("A"), buildNode("B")],
        edges: [
          buildEdge("edge-1", "A", "B", "BRIDGE", {
            price: 50,
            bridgeCostUsd: 2.0,
            gasCost: 15.0,
            latencyMs: 205,
            expectedSlippage: 0.0253,
            failureProbability: 0.05,
          }),
        ],
      },
      fillParams: {
        side: "BUY",
        price: 50,
        quantity: 1,
        depthUsd: 1_000_000,
      },
      gasType: "bridge",
      gasOptions: {
        congestionMultiplierRange: [1, 1],
        gasSpikeProbability: 0,
      },
      latencyOptions: {
        baseLatencyMs: 200,
        jitterRangeMs: [5, 5],
        spikeProbability: 0,
        spikeRangeMs: [200, 2000],
        latencyCostPerMs: 0.001,
      },
      edgeFailureProbabilities: [0.05],
    },
    {
      name: "large-order-shallow-book",
      description: "Large order in a shallow order book",
      route: ["A", "B"],
      snapshot: {
        version: 1,
        snapshotId: "snap-large-shallow",
        createdAtMs: Date.now(),
        nodes: [buildNode("A"), buildNode("B")],
        edges: [
          buildEdge("edge-1", "A", "B", "ORDER_BOOK", {
            price: 100,
            fee: 0.1,
            expectedSlippage: 50.026,
            gasCost: 7.5,
            latencyMs: 55,
            liquidityUsd: 10_000,
            failureProbability: 0.1,
          }),
        ],
      },
      fillParams: {
        side: "BUY",
        price: 100,
        quantity: 200,
        depthUsd: 10_000,
      },
      gasType: "swap",
      gasOptions: {
        congestionMultiplierRange: [1, 1],
        gasSpikeProbability: 0,
      },
      latencyOptions: {
        baseLatencyMs: 50,
        jitterRangeMs: [5, 5],
        spikeProbability: 0,
        spikeRangeMs: [200, 2000],
        latencyCostPerMs: 0.001,
      },
      fillOptions: {
        depthImpactFactor: 0.001,
        maxSlippageBps: 10000,
      },
      edgeFailureProbabilities: [0.1],
    },
  ];

  console.log(`\n=== Cost Model Validation (threshold: ${thresholdPct}%) ===\n`);

  const allResults: CostValidationResult[] = [];
  let anyFailed = false;

  for (const scenario of scenarios) {
    console.log(`Scenario: ${scenario.name} — ${scenario.description}`);
    const results = runScenario(scenario, thresholdPct);
    allResults.push(...results);

    for (const result of results) {
      printResult(result);
      if (!result.passed) {
        anyFailed = true;
      }
    }
    console.log();
  }

  const passedCount = allResults.filter((r) => r.passed).length;
  const failedCount = allResults.filter((r) => !r.passed).length;

  console.log(`--- Summary ---`);
  console.log(`Total checks: ${allResults.length}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (anyFailed) {
    console.log("\nResult: FAIL — one or more cost model estimates exceed the validation threshold.\n");
    process.exit(1);
  } else {
    console.log("\nResult: PASS — all cost model estimates are within the validation threshold.\n");
    process.exit(0);
  }
}

main();
