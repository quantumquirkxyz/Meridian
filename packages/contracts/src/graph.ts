import {
  isArrayOf,
  isBoolean,
  isEnumOf,
  isInRange,
  isNumber,
  isObjectOf,
  isOptional,
  isRecordOf,
  isString,
  parse,
  type Validator,
} from "./schema.ts";

/**
 * MarketGraph representation (Spec Alpha, user stories 11-18). The market is a
 * directed, weighted graph: nodes are assets/venues/chains/pools/accounts/
 * strategies, edges are order books/swaps/bridges/transfers/funding/
 * correlations.
 */

export const MARKET_NODE_TYPES = [
  "ASSET",
  "VENUE",
  "CHAIN",
  "POOL",
  "ACCOUNT",
  "STRATEGY",
] as const;

export type MarketNodeType = (typeof MARKET_NODE_TYPES)[number];

export const MARKET_EDGE_TYPES = [
  "ORDER_BOOK",
  "SWAP",
  "BRIDGE",
  "TRANSFER",
  "FUNDING",
  "CORRELATION",
] as const;

export type MarketEdgeType = (typeof MARKET_EDGE_TYPES)[number];

export interface MarketNode {
  /** Stable id, e.g. "asset:BTC", "venue:bybit". */
  id: string;
  type: MarketNodeType;
  /** Optional attributes (chain, pool fee tier, account role, ...). */
  meta?: Record<string, unknown>;
}

/** Edge weights as defined in the Spec Alpha implementation decisions. */
export interface EdgeWeights {
  price?: number;
  fee?: number;
  gasCost?: number;
  expectedSlippage?: number;
  latencyMs?: number;
  liquidityUsd?: number;
  /** In [0, 1]. */
  failureProbability?: number;
  /** In [0, 1]. */
  confidence?: number;
  /** In [0, 1]. */
  riskScore?: number;
}

export interface MarketEdge {
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  type: MarketEdgeType;
  weights: EdgeWeights;
  /** False when the feeding source degrades: strategies never rely on it. */
  tradable: boolean;
  /** Which connector/source produced the edge. */
  source: string;
}

/** Versioned snapshot; every decision can be tied to the graph that produced it. */
export interface MarketGraphSnapshot {
  /** Monotonic version. */
  version: number;
  /** Snapshot id (e.g. uuid) referenced by candidates and audit events. */
  snapshotId: string;
  createdAtMs: number;
  nodes: MarketNode[];
  edges: MarketEdge[];
}

const isMarketNodeType: Validator<MarketNodeType> = isEnumOf(MARKET_NODE_TYPES);
const isMarketEdgeType: Validator<MarketEdgeType> = isEnumOf(MARKET_EDGE_TYPES);

export const isMarketNode: Validator<MarketNode> = isObjectOf({
  id: isString,
  type: isMarketNodeType,
  meta: isOptional(isRecordOf(isUnknown)),
});

export const isEdgeWeights: Validator<EdgeWeights> = isObjectOf({
  price: isOptional(isNumber),
  fee: isOptional(isNumber),
  gasCost: isOptional(isNumber),
  expectedSlippage: isOptional(isNumber),
  latencyMs: isOptional(isNumber),
  liquidityUsd: isOptional(isNumber),
  failureProbability: isOptional(isInRange(0, 1)),
  confidence: isOptional(isInRange(0, 1)),
  riskScore: isOptional(isInRange(0, 1)),
});

export const isMarketEdge: Validator<MarketEdge> = isObjectOf({
  id: isString,
  from: isString,
  to: isString,
  type: isMarketEdgeType,
  weights: isEdgeWeights,
  tradable: isBoolean,
  source: isString,
});

export const isMarketGraphSnapshot: Validator<MarketGraphSnapshot> = isObjectOf({
  version: isNumber,
  snapshotId: isString,
  createdAtMs: isNumber,
  nodes: isArrayOf(isMarketNode),
  edges: isArrayOf(isMarketEdge),
});

export function parseMarketGraphSnapshot(value: unknown): MarketGraphSnapshot {
  return parse(isMarketGraphSnapshot, value, "MarketGraphSnapshot");
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}
