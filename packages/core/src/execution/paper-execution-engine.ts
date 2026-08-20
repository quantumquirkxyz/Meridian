import {
  type ApprovedRiskDecision,
  type OrderIntent,
  type ReduceRiskDecision,
  type RiskDecision,
} from "@agenttrading/contracts";

/**
 * PaperExecutionEngine: a deterministic, asynchronous execution simulator.
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

export const PAPER_ORDER_STATES = [
  "SUBMITTED",
  "ACCEPTED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
] as const;

export type PaperOrderState = (typeof PAPER_ORDER_STATES)[number];

export const PAPER_ORDER_TYPES = ["LIMIT", "MARKET"] as const;
export type PaperOrderType = (typeof PAPER_ORDER_TYPES)[number];

export interface PaperMarketSnapshot {
  bid: number;
  ask: number;
  mid: number;
  liquidityUsd: number;
  fundingRate?: number;
  latencyMs?: number;
}

export interface PaperExecutionSubmitInput {
  intent: OrderIntent;
  riskDecision: RiskDecision;
  orderType?: PaperOrderType;
  market: PaperMarketSnapshot;
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

export interface PaperOrderFill {
  filledQuantity: number;
  fillPrice: number;
  slippageBps: number;
  feesUsd: number;
  fundingCostUsd: number;
  notionalUsd: number;
}

export interface PaperOrderEvent {
  orderId: string;
  occurredAtMs: number;
  state: PaperOrderState;
  previousState?: PaperOrderState;
  note: string;
}

export interface PaperOrderSnapshot {
  orderId: string;
  intent: OrderIntent;
  orderType: PaperOrderType;
  state: PaperOrderState;
  submittedAtMs: number;
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
  events: readonly PaperOrderEvent[];
}

interface PendingOrder {
  snapshot: PaperOrderSnapshot;
  market: PaperMarketSnapshot;
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
  snapshot: PaperOrderSnapshot,
  state: PaperOrderState,
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
  orderType: PaperOrderType,
  intent: OrderIntent,
  market: PaperMarketSnapshot,
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
  intent: OrderIntent,
  market: PaperMarketSnapshot,
  remainingQuantity: number,
): number {
  const maxLiquidQuantity = market.liquidityUsd / intent.price;
  return Math.max(0, Math.min(remainingQuantity, maxLiquidQuantity));
}

export class PaperExecutionEngine {
  private readonly pending = new Map<string, PendingOrder>();

  submit(input: PaperExecutionSubmitInput): PaperOrderSnapshot {
    const acceptAfterMs =
      input.acceptAfterMs ?? input.submittedAtMs + (input.market.latencyMs ?? 0);
    const fillDelayMs = input.fillDelayMs ?? 2 * (input.market.latencyMs ?? 0);
    const fillAfterMs = input.fillAfterMs ?? input.submittedAtMs + fillDelayMs;
    const expiryAtMs = input.expiryAfterMs ?? input.intent.expiresAtMs;

    if (!executableRiskDecision(input.riskDecision)) {
      const orderId = input.intent.idempotencyKey;
      const snapshot: PaperOrderSnapshot = {
        orderId,
        intent: input.intent,
        orderType: input.orderType ?? "LIMIT",
        state: "REJECTED",
        submittedAtMs: input.submittedAtMs,
        rejectedAtMs: input.submittedAtMs,
        filledQuantity: 0,
        remainingQuantity: input.intent.quantity,
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
      const snapshot: PaperOrderSnapshot = {
        orderId: input.intent.idempotencyKey,
        intent: input.intent,
        orderType: input.orderType ?? "LIMIT",
        state: "EXPIRED",
        submittedAtMs: input.submittedAtMs,
        expiredAtMs: input.submittedAtMs,
        filledQuantity: 0,
        remainingQuantity: input.intent.quantity,
        totalFeesUsd: 0,
        totalFundingCostUsd: 0,
        riskDecision: input.riskDecision,
        events: [],
      };
      appendEvent(snapshot, "EXPIRED", input.submittedAtMs, "intent expired before submit");
      return snapshot;
    }

    const orderId = input.intent.idempotencyKey;
    const snapshot: PaperOrderSnapshot = {
      orderId,
      intent: input.intent,
      orderType: input.orderType ?? "LIMIT",
      state: "SUBMITTED",
      submittedAtMs: input.submittedAtMs,
      filledQuantity: 0,
      remainingQuantity: input.intent.quantity,
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

  poll(nowMs: number): PaperOrderEvent[] {
    const emitted: PaperOrderEvent[] = [];
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
        this.pending.delete(orderId);
        emitted.push(snapshot.events.at(-1)!);
        continue;
      }

      if (nowMs >= pending.expiryAtMs && snapshot.state !== "FILLED") {
        appendEvent(snapshot, "EXPIRED", pending.expiryAtMs, "order expired before complete fill");
        this.pending.delete(orderId);
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
        this.pending.delete(orderId);
        emitted.push(snapshot.events.at(-1)!);
        continue;
      }

      if (
        (snapshot.state === "ACCEPTED" || snapshot.state === "PARTIALLY_FILLED") &&
        nowMs >= pending.fillAfterMs
      ) {
        const remaining = snapshot.remainingQuantity;
        const fillQty = deriveFillQuantity(snapshot.intent, pending.market, remaining);
        if (fillQty <= 0) {
          appendEvent(snapshot, "REJECTED", pending.fillAfterMs, "insufficient liquidity");
          this.pending.delete(orderId);
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
          this.pending.delete(orderId);
        }
        emitted.push(snapshot.events.at(-1)!);
      }
    }
    return emitted;
  }

  cancel(orderId: string, cancelledAtMs: number): PaperOrderSnapshot | undefined {
    const pending = this.pending.get(orderId);
    if (!pending) return undefined;
    appendEvent(pending.snapshot, "CANCELLED", cancelledAtMs, "order cancelled by caller");
    this.pending.delete(orderId);
    return pending.snapshot;
  }

  snapshot(orderId: string): PaperOrderSnapshot | undefined {
    return this.pending.get(orderId)?.snapshot;
  }
}
