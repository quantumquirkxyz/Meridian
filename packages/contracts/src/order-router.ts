/**
 * OrderRouter: the single execution seam for placing real orders (ADR-0011).
 *
 * The LiveExecutionEngine accepts an optional OrderRouter. When present,
 * `placeLiveOrder` delegates to the router instead of the simulation engine.
 * This consolidates all real order placement behind one interface.
 *
 * Implementations live in cli (BybitDexOrderRouter) and never in core/agents.
 */

import {
  isEnumOf,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { type OrderIntent } from "./order.ts";

// ── Acknowledgement ──────────────────────────────────────────────────

/**
 * OrderRouteAck: returned after a successful route through the OrderRouter.
 * Carries the exchange-assigned order ID and any external reference (e.g. tx hash).
 */
export interface OrderRouteAck {
  /** Exchange-assigned order ID. */
  orderId: string;
  /** Venue the order was routed to. */
  venue: string;
  /** Optional external reference (e.g. DEX transaction hash). */
  externalRef?: string;
}

export const isOrderRouteAck: Validator<OrderRouteAck> = isObjectOf({
  orderId: isString,
  venue: isString,
  externalRef: isOptional(isString),
});

export function parseOrderRouteAck(value: unknown): OrderRouteAck {
  return parse(isOrderRouteAck, value, "OrderRouteAck");
}

// ── Router ───────────────────────────────────────────────────────────

/**
 * OrderRouter: routes an OrderIntent to the appropriate venue connector.
 *
 * The router decides by venue:
 * - "pancakeswap-v4" → DEX swap via DEXExecutor
 * - "bybit" / "binance" / other CEX → REST placeOrder
 *
 * The router never enforces canary limits — that is the engine's job.
 * The router never makes risk decisions — that is the Risk Engine's job.
 */
export interface OrderRouter {
  /**
   * Route an OrderIntent to the appropriate venue connector.
   * Returns the exchange-assigned order ID and any external reference.
   * Throws on connection/venue failure (caller handles).
   */
  route(intent: OrderIntent): Promise<OrderRouteAck>;
}

// ── Venue Routing ────────────────────────────────────────────────────

export const DEX_VENUES = ["pancakeswap-v4"] as const;
export type DexVenue = (typeof DEX_VENUES)[number];

export const isDexVenue: Validator<DexVenue> = isEnumOf(DEX_VENUES);

/** Whether an intent targets a DEX venue. */
export function isDexIntent(intent: OrderIntent): boolean {
  return DEX_VENUES.includes(intent.venue as DexVenue);
}
