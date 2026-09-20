/**
 * TradeRecord: a completed trade fill. Shared across runners.
 */

/** A single completed trade fill. */
export interface TradeRecord {
  /** Order ID (idempotency key). */
  orderId: string;
  /** Symbol traded. */
  symbol: string;
  /** Order side. */
  side: "BUY" | "SELL";
  /** Fill price. */
  fillPrice: number;
  /** Fill quantity. */
  fillQuantity: number;
  /** Notional value (USD). */
  notionalUsd: number;
  /** Fees paid (USD). */
  feesUsd: number;
  /** Slippage (basis points). */
  slippageBps: number;
  /** Fill timestamp (Unix ms). */
  filledAtMs: number;
}
