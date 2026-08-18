/**
 * Backtest runner (issue #21 AC1). Deterministic replay of a recorded event
 * session through the full simulation pipeline: event folding → graph
 * construction → opportunity detection → fill simulation → performance
 * tracking.
 *
 * A backtest session with the same seed is bit-exact reproducible:
 * identical events, identical graph states, identical fills, identical PnL.
 */

import type {
  EventEnvelope,
  MarketGraphSnapshot,
  OpportunityCandidate,
  OrderIntent,
} from "@agenttrading/contracts";
import { foldGraphState } from "@agenttrading/events";
import {
  findAndScoreRoutes,
  detectCycleCandidates,
} from "@agenttrading/graph";
import type { ScoredRoute, CostOptions, FilterOptions } from "@agenttrading/graph";
import { createSeededRng, type SeededRng } from "./seed.ts";
import { FillSimulator, type FillResult, type FillSimulatorOptions } from "./simulators/fill.ts";
import { GasSimulator, type GasEstimate, type GasSimulatorOptions } from "./simulators/gas.ts";
import { FundingSimulator, type FundingEstimate, type FundingSimulatorOptions } from "./simulators/funding.ts";
import { LatencySimulator, type LatencyEstimate, type LatencySimulatorOptions } from "./simulators/latency.ts";
import { FailureSimulator, type FailureResult, type FailureSimulatorOptions } from "./simulators/failure.ts";

/** A single simulated trade in the backtest. */
export interface BacktestTrade {
  /** The opportunity candidate that triggered this trade. */
  candidate: OpportunityCandidate;
  /** The order intent that was submitted. */
  intent: OrderIntent;
  /** The fill result. */
  fill: FillResult;
  /** Gas estimate for this trade. */
  gas: GasEstimate;
  /** Funding cost (if applicable). */
  funding?: FundingEstimate;
  /** Latency estimate for this trade. */
  latency: LatencyEstimate;
  /** Whether a failure occurred. */
  failure?: FailureResult;
  /** Net PnL for this trade (profit - costs). */
  netPnlUsd: number;
  /** Timestamp of the trade (from the opportunity). */
  timestampMs: number;
}

/** Configuration for a backtest run. */
export interface BacktestConfig {
  /** Seed for deterministic reproducibility. */
  seed: number;
  /** Events to replay (in order). */
  events: EventEnvelope[];
  /** Strategy: "route" uses findAndScoreRoutes, "cycle" uses detectCycleCandidates. */
  strategy?: "route" | "cycle";
  /** Start and end node IDs for route strategy. */
  fromNodeId?: string;
  toNodeId?: string;
  /** Gross spread to assume for scoring (USD). */
  grossSpreadUsd?: number;
  /** Simulator options. */
  fillOptions?: FillSimulatorOptions;
  gasOptions?: GasSimulatorOptions;
  fundingOptions?: FundingSimulatorOptions;
  latencyOptions?: LatencySimulatorOptions;
  failureOptions?: FailureSimulatorOptions;
  /** Cost options for route computation. */
  costOptions?: CostOptions;
  /** Filter options for route filtering. */
  filterOptions?: FilterOptions;
  /** Initial capital in USD. Default: 10000. */
  initialCapitalUsd?: number;
  /** Maximum number of trades. Default: 1000. */
  maxTrades?: number;
}

/** Default failure cost penalty in USD when a failure occurs. */
const DEFAULT_FAILURE_COST_USD = 5;

/** Result of a complete backtest run. */
export interface BacktestResult {
  /** The seed used (for reproducibility verification). */
  seed: number;
  /** All simulated trades. */
  trades: BacktestTrade[];
  /** The folded graph snapshot from replaying all events. */
  graphSnapshot: MarketGraphSnapshot;
  /** Total trades executed. */
  totalTrades: number;
  /** Total successful fills. */
  filledTrades: number;
  /** Total failed trades (failures or slippage rejections). */
  failedTrades: number;
  /** Total gross PnL before costs. */
  grossPnlUsd: number;
  /** Total costs (fees + slippage + gas + funding + latency). */
  totalCostsUsd: number;
  /** Net PnL after all costs. */
  netPnlUsd: number;
  /** Initial capital in USD. */
  initialCapitalUsd: number;
  /** Final capital. */
  finalCapitalUsd: number;
  /** Fill ratio (filled / total). */
  fillRatio: number;
  /** RNG state at end of backtest (for verification). */
  finalRngState: number;
}

export class BacktestRunner {
  private readonly gasSim: GasSimulator;
  private readonly fundingSim: FundingSimulator;
  private readonly latencySim: LatencySimulator;
  private readonly failureSim: FailureSimulator;

  constructor(config?: Partial<BacktestConfig>) {
    this.gasSim = new GasSimulator(config?.gasOptions);
    this.fundingSim = new FundingSimulator(config?.fundingOptions);
    this.latencySim = new LatencySimulator(config?.latencyOptions);
    this.failureSim = new FailureSimulator(config?.failureOptions);
  }

  /**
   * Run a complete backtest.
   *
   * 1. Fold events into a graph snapshot (deterministic replay).
   * 2. Discover and score opportunities.
   * 3. For each opportunity, simulate fill, gas, funding, latency, failures.
   * 4. Track PnL and return results.
   */
  run(config: BacktestConfig): BacktestResult {
    const {
      seed,
      events,
      strategy = "route",
      fromNodeId,
      toNodeId,
      grossSpreadUsd = 100,
      costOptions,
      filterOptions,
      initialCapitalUsd = 10_000,
      maxTrades = 1000,
    } = config;

    // Verify seed matches our RNG.
    const rng = createSeededRng(seed);

    // Step 1: Fold events into graph snapshot (deterministic).
    const graphSnapshot = foldGraphState(events);

    // Step 2: Discover and score opportunities.
    let scored: ScoredRoute[];
    if (strategy === "cycle") {
      scored = detectCycleCandidates(graphSnapshot, {
        grossSpreadUsd,
        cost: costOptions,
        filter: filterOptions,
      });
    } else {
      scored = findAndScoreRoutes(
        graphSnapshot,
        fromNodeId ?? "",
        toNodeId ?? "",
        grossSpreadUsd,
        { cost: costOptions, filter: filterOptions },
      );
    }

    // Step 3: Simulate each opportunity.
    const trades: BacktestTrade[] = [];
    let capital = initialCapitalUsd;

    for (let i = 0; i < Math.min(scored.length, maxTrades); i++) {
      const route = scored[i];
      const candidate = route.candidate;

      // Check if we have enough capital.
      const requiredCapital = candidate.maxCapitalUsd ?? 1000;
      if (capital < requiredCapital * 0.1) break; // too little capital left

      // Simulate fill.
      const fillSim = new FillSimulator(config.fillOptions);
      const fill = fillSim.simulateFill(rng, {
        side: "BUY",
        price: candidate.grossSpreadUsd > 0 ? candidate.grossSpreadUsd / (candidate.route.length - 1) : 1,
        quantity: Math.min(requiredCapital, capital) / (candidate.grossSpreadUsd / Math.max(candidate.route.length - 1, 1) || 1),
        depthUsd: candidate.maxCapitalUsd ?? 100_000,
      });

      // Simulate gas.
      const gas = this.gasSim.simulateGas(rng, "swap");

      // Simulate latency.
      const latency = this.latencySim.simulateLatency(rng);

      // Simulate failure.
      const failure = this.failureSim.simulateFailure(rng);

      // Create order intent.
      const intent: OrderIntent = {
        idempotencyKey: `bt:${seed}:${i}`,
        opportunityId: candidate.id,
        venue: "simulated",
        symbol: candidate.route[0] ?? "UNKNOWN",
        side: "BUY",
        quantity: fill.filledQuantity,
        price: fill.fillPrice,
        quoteCurrency: "USDT",
        createdAtMs: candidate.createdAtMs,
        expiresAtMs: candidate.createdAtMs + 30_000,
        limits: {
          maxSlippageBps: 500,
          maxGasUsd: 50,
        },
      };

      // Compute net PnL.
      const totalCosts =
        fill.slippageUsd +
        gas.gasCostUsd +
        latency.latencyCostUsd +
        (failure.failed ? DEFAULT_FAILURE_COST_USD : 0);

      const netPnlUsd = fill.filled
        ? candidate.expectedNetProfitUsd * fill.fillRatio - totalCosts
        : -totalCosts;

      capital += netPnlUsd;

      trades.push({
        candidate,
        intent,
        fill,
        gas,
        latency,
        failure: failure.failed ? failure : undefined,
        netPnlUsd,
        timestampMs: candidate.createdAtMs,
      });
    }

    // Step 4: Aggregate results.
    const filledTrades = trades.filter((t) => t.fill.filled).length;
    const failedTrades = trades.filter(
      (t) => !t.fill.filled || t.failure?.failed,
    ).length;
    const grossPnlUsd = trades.reduce(
      (sum, t) => sum + (t.fill.filled ? t.candidate.expectedNetProfitUsd * t.fill.fillRatio : 0),
      0,
    );
    const totalCostsUsd = trades.reduce(
      (sum, t) =>
        sum +
        t.fill.slippageUsd +
        t.gas.gasCostUsd +
        t.latency.latencyCostUsd,
      0,
    );

    return {
      seed,
      trades,
      graphSnapshot,
      totalTrades: trades.length,
      filledTrades,
      failedTrades,
      grossPnlUsd,
      totalCostsUsd,
      netPnlUsd: grossPnlUsd - totalCostsUsd,
      initialCapitalUsd,
      finalCapitalUsd: capital,
      fillRatio: trades.length > 0 ? filledTrades / trades.length : 0,
      finalRngState: rng.getState(),
    };
  }
}
