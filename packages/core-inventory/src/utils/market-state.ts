/**
 * Shared MarketState type for bundled market data.
 *
 * S2 (review fix): Both LiveRunner track bid, ask, mid,
 * and liquidityUsd together. This type bundles them to avoid data clumps.
 */

/** Bundled market state from WebSocket data. */
export interface MarketState {
  bid: number;
  ask: number;
  mid: number;
  liquidityUsd: number;
}
