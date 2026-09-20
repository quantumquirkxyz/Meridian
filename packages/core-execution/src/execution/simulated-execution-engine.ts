import {
  type ApprovedRiskDecision,
  type OrderIntent,
  type ReduceRiskDecision,
  type RiskDecision,
} from "@agenttrading/contracts";

/**
 * SimulatedExecutionEngine: a deterministic, asynchronous execution simulator.
 *
 * The seam is deliberately narrow:
 * - only risk-approved intents may be submitted
 * - submit, accept, partial fill, fill, cancel, reject, and expiry are all
 *   modeled as distinct state transitions
 * - confirmations are not instantaneous; callers must poll or advance time
 *
 * This mirrors the operational shape of WebSocket-backed exchange APIs where
 * order creation, acceptance, and final fill are separate observations.
 */

export const ORDER_STATES = [
  "SUBMITTED",
  "ACCEPTED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export const ORDER_TYPES = ["LIMIT", "MARKET"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export interface MarketSnapshot {
  bid: number;
  ask: number;
  mid: number;
  liquidityUsd: number;
  fundingRate?: number;
  latencyMs?: number;
}

export interface ExecutionSubmitInput {
  intent: OrderIntent;
  riskDecision: RiskDecision;
  orderType?: OrderType;
  market: MarketSnapshot;
  submittedAtMs: number;
  acceptAfterMs?: number;
  fillAfterMs?: number;
  fillDelayMs?: number;
  cancelAfterMs?: number;
  rejectReason?: string;
  expiryAfterMs?: number;
  slippageBps?: number;
  feeBps?: number;
  fundingCostUsd?: number;
}

export interface OrderFill {
  filledQuantity: number;
  fillPrice: number;
  slippageBps: number;
  feesUsd: number;
  fundingCostUsd: number;
  notionalUsd: number;
}

export interface OrderEvent {
  orderId: string;
  occurredAtMs: number;
  state: OrderState;
  previousState?: OrderState;
  note: string;
}

export interface OrderSnapshot {
  orderId: string;
  intent: OrderIntent;
  orderType: OrderType;
  state: OrderState;
  submittedAtMs: number;
  approvedQuantity: number;
  acceptedAtMs?: number;
  filledAtMs?: number;
  cancelledAtMs?: number;
  rejectedAtMs?: number;
  expiredAtMs?: number;
  filledQuantity: number;
  remainingQuantity: number;
  averageFillPrice?: number;
  totalFeesUsd: number;
  totalFundingCostUsd: number;
  riskDecision: RiskDecision;
  events: readonly OrderEvent[];
}

interface PendingOrder {
  snapshot: OrderSnapshot;
  market: MarketSnapshot;
  acceptAfterMs: number;
  fillAfterMs: number;
  fillDelayMs: number;
  cancelAfterMs?: number;
  expiryAtMs: number;
  rejectReason?: string;
  slippageBps: number;
  feeBps: number;
  fundingCostUsd: number;
}

function executableRiskDecision(
  decision: RiskDecision,
): decision is ApprovedRiskDecision | ReduceRiskDecision {
  return decision.decision === "APPROVE" || decision.decision === "REDUCE_SIZE";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function appendEvent(
  snapshot: OrderSnapshot,
  state: OrderState,
  occurredAtMs: number,
  note: string,
): void {
  const previousState = snapshot.state;
  snapshot.state = state;
  if (state === "ACCEPTED") snapshot.acceptedAtMs = occurredAtMs;
  if (state === "FILLED") snapshot.filledAtMs = occurredAtMs;
  if (state === "CANCELLED") snapshot.cancelledAtMs = occurredAtMs;
  if (state === "REJECTED") snapshot.rejectedAtMs = occurredAtMs;
  if (state === "EXPIRED") snapshot.expiredAtMs = occurredAtMs;
  snapshot.events = [
    ...snapshot.events,
    { orderId: snapshot.orderId, occurredAtMs, state, previousState, note },
  ];
}

function deriveFillPrice(
  orderType: OrderType,
  intent: OrderIntent,
  market: MarketSnapshot,
  slippageBps: number,
): number {
  if (orderType === "LIMIT") {
    return intent.price;
  }
  const direction = intent.side === "BUY" ? 1 : -1;
  const base = market.mid;
  const slip = (base * slippageBps) / 10_000;
  return base + direction * slip;
}

function deriveFillQuantity(
  approvedQuantity: number,
  intent: OrderIntent,
  market: MarketSnapshot,
  remainingQuantity: number,
): number {
  const maxLiquidQuantity = market.liquidityUsd / intent.price;
  return Math.max(0, Math.min(remainingQuantity, approvedQuantity, maxLiquidQuantity));
}

export class SimulatedExecutionEngine {
  private readonly pending = new Map<string, PendingOrder>();
  private readonly completed = new Map<string, PendingOrder>();

  private archive(orderId: string): void {
    const order = this.pending.get(orderId);
    if (order) {
      this.pending.delete(orderId);
      this.completed.set(orderId, order);
    }
  }

  submit(input: ExecutionSubmitInput): OrderSnapshot {
    const acceptAfterMs =
      input.acceptAfterMs ?? input.submittedAtMs + (input.market.latencyMs ?? 0);
    const fillDelayMs = input.fillDelayMs ?? 2 * (input.market.latencyMs ?? 0);
    const fillAfterMs = input.fillAfterMs ?? input.submittedAtMs + fillDelayMs;
    const expiryAtMs = input.expiryAfterMs ?? input.intent.expiresAtMs;

    if (!executableRiskDecision(input.riskDecision)) {
      const orderId = input.intent.idempotencyKey;
      const snapshot: OrderSnapshot = {
        orderId,
        intent: input.intent,
        orderType: input.orderType ?? "LIMIT",
        state: "REJECTED",
        submittedAtMs: input.submittedAtMs,
        approvedQuantity: 0,
        rejectedAtMs: input.submittedAtMs,
        filledQuantity: 0,
        remainingQuantity: 0,
        totalFeesUsd: 0,
        totalFundingCostUsd: 0,
        riskDecision: input.riskDecision,
        events: [],
      };
      appendEvent(
        snapshot,
        "REJECTED",
        input.submittedAtMs,
        `risk decision ${input.riskDecision.decision} is not executable`,
      );
      return snapshot;
    }

    if (input.intent.expiresAtMs <= input.submittedAtMs) {
      const snapshot: OrderSnapshot = {
        orderId: input.intent.idempotencyKey,
        intent: input.intent,
        orderType: input.orderType ?? "LIMIT",
        state: "EXPIRED",
        submittedAtMs: input.submittedAtMs,
        approvedQuantity:
          input.riskDecision.decision === "REDUCE_SIZE"
            ? input.riskDecision.approvedSize
            : input.intent.quantity,
        expiredAtMs: input.submittedAtMs,
        filledQuantity: 0,
        remainingQuantity:
          input.riskDecision.decision === "REDUCE_SIZE"
            ? input.riskDecision.approvedSize
            : input.intent.quantity,
        totalFeesUsd: 0,
        totalFundingCostUsd: 0,
        riskDecision: input.riskDecision,
        events: [],
      };
      appendEvent(snapshot, "EXPIRED", input.submittedAtMs, "intent expired before submit");
      return snapshot;
    }

    const orderId = input.intent.idempotencyKey;
    const snapshot: OrderSnapshot = {
      orderId,
      intent: input.intent,
      orderType: input.orderType ?? "LIMIT",
      state: "SUBMITTED",
      submittedAtMs: input.submittedAtMs,
      approvedQuantity:
        input.riskDecision.decision === "REDUCE_SIZE"
          ? input.riskDecision.approvedSize
          : input.intent.quantity,
      filledQuantity: 0,
      remainingQuantity:
        input.riskDecision.decision === "REDUCE_SIZE"
          ? input.riskDecision.approvedSize
          : input.intent.quantity,
      totalFeesUsd: 0,
      totalFundingCostUsd: 0,
      riskDecision: input.riskDecision,
      events: [],
    };
    appendEvent(snapshot, "SUBMITTED", input.submittedAtMs, "order submitted");

    this.pending.set(orderId, {
      snapshot,
      market: input.market,
      acceptAfterMs,
      fillAfterMs,
      fillDelayMs,
      cancelAfterMs: input.cancelAfterMs,
      expiryAtMs,
      rejectReason: input.rejectReason,
      slippageBps: input.slippageBps ?? input.intent.limits.maxSlippageBps ?? 0,
      feeBps: input.feeBps ?? 2,
      fundingCostUsd: input.fundingCostUsd ?? 0,
    });
    return snapshot;
  }

  poll(nowMs: number): OrderEvent[] {
    const emitted: OrderEvent[] = [];
    for (const [orderId, pending] of this.pending) {
      const { snapshot } = pending;
      if (snapshot.state === "SUBMITTED" && nowMs >= pending.acceptAfterMs) {
        appendEvent(snapshot, "ACCEPTED", pending.acceptAfterMs, "exchange accepted order asynchronously");
        emitted.push(snapshot.events.at(-1)!);
      }

      if (
        snapshot.state === "ACCEPTED" &&
        pending.rejectReason !== undefined &&
        nowMs >= pending.fillAfterMs
      ) {
        appendEvent(snapshot, "REJECTED", pending.fillAfterMs, pending.rejectReason);
        this.archive(orderId);
        emitted.push(snapshot.events.at(-1)!);
        continue;
      }

      if (nowMs >= pending.expiryAtMs && snapshot.state !== "FILLED") {
        appendEvent(snapshot, "EXPIRED", pending.expiryAtMs, "order expired before complete fill");
        this.archive(orderId);
        emitted.push(snapshot.events.at(-1)!);
        continue;
      }

      if (
        pending.cancelAfterMs !== undefined &&
        nowMs >= pending.cancelAfterMs &&
        snapshot.state !== "FILLED" &&
        snapshot.state !== "CANCELLED"
      ) {
        appendEvent(snapshot, "CANCELLED", pending.cancelAfterMs, "order cancelled by caller");
        this.archive(orderId);
        emitted.push(snapshot.events.at(-1)!);
        continue;
      }

      if (
        (snapshot.state === "ACCEPTED" || snapshot.state === "PARTIALLY_FILLED") &&
        nowMs >= pending.fillAfterMs
      ) {
        const remaining = snapshot.remainingQuantity;
        const fillQty = deriveFillQuantity(
          snapshot.approvedQuantity,
          snapshot.intent,
          pending.market,
          remaining,
        );
        if (fillQty <= 0) {
          appendEvent(snapshot, "REJECTED", pending.fillAfterMs, "insufficient liquidity");
          this.archive(orderId);
          emitted.push(snapshot.events.at(-1)!);
          continue;
        }

        const slippageBps = clamp(
          pending.slippageBps,
          0,
          snapshot.intent.limits.maxSlippageBps ?? pending.slippageBps,
        );
        const fillPrice = deriveFillPrice(
          snapshot.orderType,
          snapshot.intent,
          pending.market,
          slippageBps,
        );
        const notionalUsd = fillQty * fillPrice;
        const feesUsd = (notionalUsd * pending.feeBps) / 10_000;
        snapshot.filledQuantity += fillQty;
        snapshot.remainingQuantity = Math.max(0, snapshot.remainingQuantity - fillQty);
        snapshot.totalFeesUsd += feesUsd;
        snapshot.totalFundingCostUsd += pending.fundingCostUsd;
        snapshot.averageFillPrice = fillPrice;

        if (snapshot.remainingQuantity > 0) {
          const fillEventAt = pending.fillAfterMs;
          pending.fillAfterMs = nowMs + pending.fillDelayMs;
          appendEvent(
            snapshot,
            "PARTIALLY_FILLED",
            fillEventAt,
            `filled ${fillQty} of ${remaining}; waiting for remaining liquidity`,
          );
        } else {
          appendEvent(
            snapshot,
            "FILLED",
            pending.fillAfterMs,
            `filled ${fillQty} at ${fillPrice.toFixed(4)} with ${slippageBps}bps slippage`,
          );
          this.archive(orderId);
        }
        emitted.push(snapshot.events.at(-1)!);
      }
    }
    return emitted;
  }

  cancel(orderId: string, cancelledAtMs: number): OrderSnapshot | undefined {
    const pending = this.pending.get(orderId);
    if (!pending) return undefined;
    appendEvent(pending.snapshot, "CANCELLED", cancelledAtMs, "order cancelled by caller");
    this.archive(orderId);
    return pending.snapshot;
  }

  cancelAll(cancelledAtMs: number): OrderSnapshot[] {
    const cancelled: OrderSnapshot[] = [];
    for (const orderId of [...this.pending.keys()]) {
      const snapshot = this.cancel(orderId, cancelledAtMs);
      if (snapshot !== undefined) {
        cancelled.push(snapshot);
      }
    }
    return cancelled;
  }

  pendingSnapshots(): OrderSnapshot[] {
    return [...this.pending.values()].map((pending) => pending.snapshot);
  }

  openOrderCount(): number {
    return this.pending.size;
  }

  snapshot(orderId: string): OrderSnapshot | undefined {
    return this.pending.get(orderId)?.snapshot ?? this.completed.get(orderId)?.snapshot;
  }
}
