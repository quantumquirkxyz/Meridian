import {
  type BetaPaperInventoryInput,
  type BetaPaperExecutionOptions,
  type BetaPaperTradingScenario,
} from "./paper-trading-session.ts";

import {
  type BalanceEntry,
  type InventorySnapshot,
  type InventoryValidation,
  type PriceMap,
} from "../inventory/inventory-engine.ts";
import { InventoryEngine } from "../inventory/inventory-engine.ts";
import {
  PaperExecutionEngine,
  type PaperExecutionSubmitInput,
  type PaperMarketSnapshot,
  type PaperOrderSnapshot,
} from "../execution/paper-execution-engine.ts";
import {
  type OrderIntent,
  type RiskDecision,
} from "@agenttrading/contracts";

const DEFAULT_QUOTE_BUFFER_MULTIPLIER = 2;
const DEFAULT_LIQUIDITY_USD = 1_000;
const DEFAULT_SPREAD = 0.5;
const DEFAULT_SLIPPAGE_BPS = 30;
const ORDER_TTL_MS = 60_000;

type ExecutableRiskDecision = Extract<
  RiskDecision,
  { decision: "APPROVE" | "REDUCE_SIZE" }
>;

/**
 * Owns scenario-bound order intent construction, inventory evaluation,
 * paper execution, and market snapshot generation. Each method receives only
 * the external context it actually needs — the executor owns the scenario
 * state that previously caused feature envy across five session methods.
 */
export class PaperScenarioExecutor {
  private readonly inventoryEngine: InventoryEngine;
  private readonly paperExecution: PaperExecutionEngine;

  constructor(
    inventoryEngine: InventoryEngine,
    paperExecution: PaperExecutionEngine,
  ) {
    this.inventoryEngine = inventoryEngine;
    this.paperExecution = paperExecution;
  }

  buildOrderIntent(
    scenario: BetaPaperTradingScenario,
    opportunityId: string,
    timestampMs: number,
  ): OrderIntent {
    return {
      idempotencyKey: `intent-${scenario.id}`,
      opportunityId,
      venue: scenario.venue ?? "bybit-paper",
      symbol: scenario.symbol ?? "BTC/USDT",
      side: "BUY",
      quantity: scenario.quantity ?? 0.01,
      price: scenario.price ?? 100,
      quoteCurrency: "USDT",
      createdAtMs: timestampMs,
      expiresAtMs: timestampMs + ORDER_TTL_MS,
      limits: { maxSlippageBps: DEFAULT_SLIPPAGE_BPS },
    };
  }

  evaluateInventory(
    scenario: BetaPaperTradingScenario,
    orderIntent: OrderIntent,
    timestampMs: number,
  ): { snapshot: InventorySnapshot; validation: InventoryValidation } {
    const baseAsset = orderIntent.symbol.split("/")[0] ?? "BTC";
    const quoteAsset = orderIntent.quoteCurrency;
    const requiredNotionalUsd = orderIntent.quantity * orderIntent.price;
    const paperInventory = scenario.paperInventory ?? {
      balances: [
        {
          venueType: "CEX" as const,
          venue: orderIntent.venue,
          chain: "",
          asset: quoteAsset,
          available: requiredNotionalUsd * DEFAULT_QUOTE_BUFFER_MULTIPLIER,
          locked: 0,
          exposed: 0,
          lastSyncAtMs: timestampMs,
        },
        {
          venueType: "CEX" as const,
          venue: orderIntent.venue,
          chain: "",
          asset: baseAsset,
          available: 0,
          locked: 0,
          exposed: 0,
          lastSyncAtMs: timestampMs,
        },
      ],
      prices: {
        [baseAsset.toUpperCase()]: orderIntent.price,
        [quoteAsset.toUpperCase()]: 1,
      },
      strategyAllocations: [
        {
          strategyId: "beta-paper",
          maxAllocationUsd:
            requiredNotionalUsd * DEFAULT_QUOTE_BUFFER_MULTIPLIER,
          deployedUsd: 0,
        },
      ],
    };
    const snapshot = this.inventoryEngine.snapshot({
      balances: paperInventory.balances,
      prices: paperInventory.prices,
      strategyAllocations: paperInventory.strategyAllocations,
      evaluatedAtMs: timestampMs,
    });
    const validation = this.inventoryEngine.validate(
      {
        asset: quoteAsset,
        venue: orderIntent.venue,
        side: "BUY",
        notionalUsd: requiredNotionalUsd,
        strategyId: "beta-paper",
        evaluatedAtMs: timestampMs,
      },
      snapshot,
    );
    return { snapshot, validation };
  }

  market(scenario: BetaPaperTradingScenario): PaperMarketSnapshot {
    const price = scenario.price ?? 100;
    return {
      bid: price - DEFAULT_SPREAD,
      ask: price + DEFAULT_SPREAD,
      mid: price,
      liquidityUsd: DEFAULT_LIQUIDITY_USD,
      latencyMs: 1,
      ...scenario.market,
    };
  }

  executePaperOrder(
    scenario: BetaPaperTradingScenario,
    orderIntent: OrderIntent,
    riskDecision: ExecutableRiskDecision,
    timestampMs: number,
  ): PaperOrderSnapshot {
    const executionOptions = scenario.paperExecution ?? {};
    const execution = this.paperExecution.submit({
      intent: orderIntent,
      riskDecision,
      market: this.market(scenario),
      submittedAtMs: timestampMs,
      acceptAfterMs: executionOptions.acceptAfterMs ?? timestampMs,
      fillAfterMs: executionOptions.fillAfterMs ?? timestampMs,
      fillDelayMs: executionOptions.fillDelayMs,
      cancelAfterMs: executionOptions.cancelAfterMs,
      rejectReason: executionOptions.rejectReason,
      expiryAfterMs: executionOptions.expiryAfterMs,
      slippageBps: executionOptions.slippageBps,
      feeBps: executionOptions.feeBps,
      fundingCostUsd: executionOptions.fundingCostUsd,
    } satisfies PaperExecutionSubmitInput);
    this.paperExecution.poll(timestampMs);
    return execution;
  }
}
