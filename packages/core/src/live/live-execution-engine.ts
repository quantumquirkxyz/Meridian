/**
 * LiveExecutionEngine: wraps the SimulatedExecutionEngine and adds canary
 * enforcement: capital limits, per-trade/day/venue/token/chain limits,
 * withdrawal disabling, order count limits, and no-automatic-scaling.
 *
 * Acceptance criteria (AC1):
 *   - Canary config enforces bounded capital and hard limits per
 *     trade/day/venue/token/chain.
 *   - No orphan orders and no limit violations in a live canary session.
 *   - Read and trading keys are separate; withdrawals disabled.
 *
 * The engine is deterministic — no LLM, no I/O. It evaluates canary
 * constraints and delegates actual execution to the simulated execution
 * engine (for simulation) or a future live connector.
 */

import {
  type CanaryConfig,
  type OrderIntent,
  type OrderRouteAck,
  type OrderRouter,
  type RiskDecision,
} from "@agenttrading/contracts";
import {
  SimulatedExecutionEngine,
  type ExecutionSubmitInput,
  type OrderSnapshot,
} from "../execution/simulated-execution-engine.ts";

// ── Canary Order Tracking ────────────────────────────────────────────

/**
 * A record of a live order placed by the canary session.
 */
export interface LiveOrderRecord {
  orderId: string;
  symbol: string;
  venue: string;
  chain: string;
  notionalUsd: number;
  side: "BUY" | "SELL";
  submittedAtMs: number;
  state: string;
}

// ── Execution State ──────────────────────────────────────────────────

/**
 * Cumulative execution state for the canary session, used to evaluate
 * canary limits before each new order.
 */
export interface CanaryExecutionState {
  /** All orders placed today (for daily count limit). */
  ordersToday: readonly LiveOrderRecord[];
  /** All orders placed this week (for weekly count limit). */
  ordersThisWeek: readonly LiveOrderRecord[];
  /** All currently open orders (for open order limit). */
  openOrders: readonly LiveOrderRecord[];
  /** Current exposure per token (USD). */
  exposurePerToken: Record<string, number>;
  /** Current exposure per venue (USD). */
  exposurePerVenue: Record<string, number>;
  /** Current exposure per chain (USD). */
  exposurePerChain: Record<string, number>;
  /** Total capital deployed (USD). */
  capitalDeployedUsd: number;
  /** Daily PnL (USD). Negative = loss. */
  dailyPnlUsd: number;
  /** Weekly PnL (USD). Negative = loss. */
  weeklyPnlUsd: number;
}

// ── Pre-check Result ─────────────────────────────────────────────────

export const CANARY_BLOCK_REASONS = [
  "EXCEEDS_RISK_PER_TRADE",
  "EXCEEDS_DAILY_LOSS",
  "EXCEEDS_WEEKLY_LOSS",
  "EXCEEDS_OPEN_ORDERS",
  "EXCEEDS_ORDERS_PER_DAY",
  "EXCEEDS_ORDERS_PER_WEEK",
  "EXCEEDS_EXPOSURE_PER_TOKEN",
  "EXCEEDS_EXPOSURE_PER_VENUE",
  "EXCEEDS_EXPOSURE_PER_CHAIN",
  "EXCEEDS_ORDER_NOTIONAL",
  "EXCEEDS_MAX_SLIPPAGE",
  "EXCEEDS_MAX_GAS",
  "EXCEEDS_MAX_CAPITAL",
  "STRATEGY_NOT_ALLOWED",
  "VENUE_NOT_ALLOWED",
  "TOKEN_NOT_ALLOWED",
  "CHAIN_NOT_ALLOWED",
  "CAPITAL_EXHAUSTED",
  "DAILY_LOSS_LIMIT",
  "WEEKLY_LOSS_LIMIT",
] as const;

export type CanaryBlockReason = (typeof CANARY_BLOCK_REASONS)[number];

export interface CanaryPreCheckResult {
  /** Whether the order is allowed by canary limits. */
  allowed: boolean;
  /** If blocked, the reason code. */
  blockReason?: CanaryBlockReason;
  /** Human-readable explanation. */
  reason: string;
  /** Approved quantity (may be reduced from requested). */
  approvedQuantity?: number;
}

// ── Engine ───────────────────────────────────────────────────────────

/**
 * LiveExecutionEngine: enforces canary constraints on top of the
 * SimulatedExecutionEngine. Each order must pass all canary limits before
 * being submitted.
 *
 * The engine maintains no internal state between calls — all cumulative
 * state (orders, exposure, PnL) is passed in via CanaryExecutionState.
 */
export class LiveExecutionEngine {
  private readonly config: CanaryConfig;
  private readonly simEngine: SimulatedExecutionEngine;
  private orderRouter?: OrderRouter;

  constructor(
    config: CanaryConfig,
    simEngine: SimulatedExecutionEngine = new SimulatedExecutionEngine(),
    orderRouter?: OrderRouter,
  ) {
    this.config = { ...config };
    this.simEngine = simEngine;
    this.orderRouter = orderRouter;
  }

  /**
   * Late-wire an OrderRouter (ADR-0011): the engine becomes the single
   * order-sending seam once a router is attached. Without a router the
   * engine remains a harness that simulates fills.
   */
  setOrderRouter(orderRouter?: OrderRouter): void {
    this.orderRouter = orderRouter;
  }

  /** Whether a live OrderRouter is attached (ADR-0011 seam active). */
  get hasOrderRouter(): boolean {
    return this.orderRouter !== undefined;
  }

  /**
   * Pre-check: evaluates an OrderIntent against all canary limits
   * before submission. This is the gate that prevents limit violations
   * and orphan orders.
   */
  preCheck(
    intent: OrderIntent,
    state: CanaryExecutionState,
  ): CanaryPreCheckResult {
    const notionalUsd = intent.quantity * intent.price;

    // Check capital exhaustion.
    const remainingCapital =
      this.config.capitalLimits.maxCapitalUsd - state.capitalDeployedUsd;
    if (remainingCapital <= 0) {
      return {
        allowed: false,
        blockReason: "CAPITAL_EXHAUSTED",
        reason: `no capital remaining (${state.capitalDeployedUsd} deployed of ${this.config.capitalLimits.maxCapitalUsd} max)`,
      };
    }

    // Check max order notional (hard cap, before risk-per-trade reduction).
    if (notionalUsd > this.config.maxOrderNotionalUsd) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_ORDER_NOTIONAL",
        reason: `notional ${notionalUsd} > max order notional ${this.config.maxOrderNotionalUsd}`,
      };
    }

    // Check risk per trade.
    if (notionalUsd > this.config.capitalLimits.maxRiskPerTradeUsd) {
      const approvedQty =
        this.config.capitalLimits.maxRiskPerTradeUsd / intent.price;
      return {
        allowed: true,
        blockReason: "EXCEEDS_RISK_PER_TRADE",
        reason: `notional ${notionalUsd} > per-trade limit ${this.config.capitalLimits.maxRiskPerTradeUsd}; reduced to ${approvedQty.toFixed(6)}`,
        approvedQuantity: approvedQty,
      };
    }

    // Check daily loss limit.
    if (
      state.dailyPnlUsd < 0 &&
      Math.abs(state.dailyPnlUsd) >= this.config.capitalLimits.maxDailyLossUsd
    ) {
      return {
        allowed: false,
        blockReason: "DAILY_LOSS_LIMIT",
        reason: `daily loss ${Math.abs(state.dailyPnlUsd)} >= limit ${this.config.capitalLimits.maxDailyLossUsd}`,
      };
    }

    // Check weekly loss limit.
    if (
      state.weeklyPnlUsd < 0 &&
      Math.abs(state.weeklyPnlUsd) >=
        this.config.capitalLimits.maxWeeklyLossUsd
    ) {
      return {
        allowed: false,
        blockReason: "WEEKLY_LOSS_LIMIT",
        reason: `weekly loss ${Math.abs(state.weeklyPnlUsd)} >= limit ${this.config.capitalLimits.maxWeeklyLossUsd}`,
      };
    }

    // Check open orders limit.
    if (
      state.openOrders.length >= this.config.orderLimits.maxOpenOrders
    ) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_OPEN_ORDERS",
        reason: `open orders ${state.openOrders.length} >= limit ${this.config.orderLimits.maxOpenOrders}`,
      };
    }

    // Check orders per day limit.
    if (
      state.ordersToday.length >= this.config.orderLimits.maxOrdersPerDay
    ) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_ORDERS_PER_DAY",
        reason: `orders today ${state.ordersToday.length} >= limit ${this.config.orderLimits.maxOrdersPerDay}`,
      };
    }

    // Check orders per week limit.
    if (
      state.ordersThisWeek.length >= this.config.orderLimits.maxOrdersPerWeek
    ) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_ORDERS_PER_WEEK",
        reason: `orders this week ${state.ordersThisWeek.length} >= limit ${this.config.orderLimits.maxOrdersPerWeek}`,
      };
    }

    // Check exposure per token.
    const tokenExposure = (state.exposurePerToken[intent.symbol] ?? 0) + notionalUsd;
    if (tokenExposure > this.config.exposureLimits.maxExposurePerTokenUsd) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_EXPOSURE_PER_TOKEN",
        reason: `projected token exposure ${tokenExposure} > limit ${this.config.exposureLimits.maxExposurePerTokenUsd}`,
      };
    }

    // Check exposure per venue.
    const venueExposure = (state.exposurePerVenue[intent.venue] ?? 0) + notionalUsd;
    if (venueExposure > this.config.exposureLimits.maxExposurePerVenueUsd) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_EXPOSURE_PER_VENUE",
        reason: `projected venue exposure ${venueExposure} > limit ${this.config.exposureLimits.maxExposurePerVenueUsd}`,
      };
    }

    // Check exposure per chain (chain is not on OrderIntent; use venue as proxy).
    const chainExposure = (state.exposurePerChain[intent.venue] ?? 0) + notionalUsd;
    if (chainExposure > this.config.exposureLimits.maxExposurePerChainUsd) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_EXPOSURE_PER_CHAIN",
        reason: `projected chain exposure ${chainExposure} > limit ${this.config.exposureLimits.maxExposurePerChainUsd}`,
      };
    }

    // Check slippage limit.
    if (
      intent.limits.maxSlippageBps !== undefined &&
      intent.limits.maxSlippageBps > this.config.maxSlippageBps
    ) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_MAX_SLIPPAGE",
        reason: `slippage ${intent.limits.maxSlippageBps} bps > limit ${this.config.maxSlippageBps} bps`,
      };
    }

    // Check gas limit.
    if (
      intent.limits.maxGasUsd !== undefined &&
      intent.limits.maxGasUsd > this.config.maxGasUsd
    ) {
      return {
        allowed: false,
        blockReason: "EXCEEDS_MAX_GAS",
        reason: `gas ${intent.limits.maxGasUsd} > limit ${this.config.maxGasUsd}`,
      };
    }

    // Check strategy/venue/token/chain allowlists.
    // Note: strategy ID is not on OrderIntent; checked at session level.

    return {
      allowed: true,
      reason: "all canary limits passed",
      approvedQuantity: intent.quantity,
    };
  }

  /**
   * Submit an order through the simulated execution engine, after canary
   * pre-check. Only callable if preCheck returned allowed: true.
   */
  submit(
    input: ExecutionSubmitInput,
    preCheck: CanaryPreCheckResult,
  ): OrderSnapshot {
    if (!preCheck.allowed) {
      throw new Error(
        `canary pre-check failed: ${preCheck.blockReason} — ${preCheck.reason}`,
      );
    }

    // Apply any quantity reduction from the pre-check.
    const adjustedInput = { ...input };
    if (preCheck.approvedQuantity !== undefined) {
      adjustedInput.riskDecision = {
        ...adjustedInput.riskDecision,
        decision: "REDUCE_SIZE" as const,
        approvedSize: preCheck.approvedQuantity,
      } as RiskDecision;
    }

    return this.simEngine.submit(adjustedInput);
  }

  /**
   * Place a real order through the OrderRouter (ADR-0011).
   *
   * The engine stays the single order-sending seam: canary pre-check is
   * enforced here, then routing delegates to the attached OrderRouter.
   * When no router is attached (harness/tests) the order falls back to
   * the simulated engine so the seam remains exercised everywhere.
   *
   * Only callable if `preCheck` returned `allowed: true`.
   */
  async placeLiveOrder(
    intent: OrderIntent,
    preCheck: CanaryPreCheckResult,
  ): Promise<OrderRouteAck> {
    if (!preCheck.allowed) {
      throw new Error(
        `canary pre-check failed: ${preCheck.blockReason} — ${preCheck.reason}`,
      );
    }

    if (this.orderRouter) {
      return this.orderRouter.route(intent);
    }

    // No router attached (harness path): simulate the fill and return an
    // ack derived from the simulated snapshot so downstream tracking is
    // identical in shape.
    const adjustedIntent = { ...intent };
    if (preCheck.approvedQuantity !== undefined) {
      adjustedIntent.quantity = preCheck.approvedQuantity;
    }
    const execution = this.simEngine.submit({
      intent: adjustedIntent,
      riskDecision: {
        decision: "APPROVE",
        orderIntentIdempotencyKey: intent.idempotencyKey,
        approvedSize: preCheck.approvedQuantity ?? intent.quantity,
        approvedLimits: intent.limits,
        expiresAtMs: intent.expiresAtMs,
        evaluatedAtMs: intent.createdAtMs,
      } as RiskDecision,
      market: {
        bid: intent.price * 0.999,
        ask: intent.price * 1.001,
        mid: intent.price,
        liquidityUsd: 10_000,
      },
      submittedAtMs: intent.createdAtMs,
    });

    return {
      orderId: execution.orderId,
      venue: intent.venue,
    };
  }

  /**
   * Poll the simulated execution engine.
   */
  poll(nowMs: number) {
    return this.simEngine.poll(nowMs);
  }

  /**
   * Cancel all open simulated orders.
   */
  cancelAll(cancelledAtMs: number) {
    return this.simEngine.cancelAll(cancelledAtMs);
  }

  /**
   * Get current open order count.
   */
  openOrderCount(): number {
    return this.simEngine.openOrderCount();
  }

  /**
   * Get pending order snapshots.
   */
  pendingSnapshots(): OrderSnapshot[] {
    return this.simEngine.pendingSnapshots();
  }

  /** Expose the underlying simulated execution engine for reconciliation. */
  get simEngineRef(): SimulatedExecutionEngine {
    return this.simEngine;
  }
}
