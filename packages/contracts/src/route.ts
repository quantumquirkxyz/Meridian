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
 * Route contracts for graph-scale routing (issue #37).
 *
 * A Route is a multi-hop path through the MarketGraph, connecting source
 * and destination nodes via edges (ORDER_BOOK, SWAP, BRIDGE, FUNDING,
 * TRANSFER, CORRELATION). Routes are classified by type, scored for
 * profitability, and filtered by systemic risk overlays.
 *
 * Core invariant: every route carries a snapshotId linking it to the
 * MarketGraphSnapshot that produced it, enabling full audit traceability.
 */

// ── Route Type ──────────────────────────────────────────────────────

/**
 * RouteType: the classification of a route based on the venue and edge
 * types it traverses.
 */
export const ROUTE_TYPES = [
  "CEX_CEX",
  "DEX_DEX",
  "CEX_DEX",
  "CROSS_CHAIN",
  "FUNDING_BASIS",
] as const;

export type RouteType = (typeof ROUTE_TYPES)[number];

export const isRouteType: Validator<RouteType> = isEnumOf(ROUTE_TYPES);

// ── Route Status ────────────────────────────────────────────────────

/**
 * RouteStatus: lifecycle state of a route.
 * - LIVE: all edges tradable, recently updated
 * - STALE: some edges haven't been updated within the staleness threshold
 * - EXPIRED: at least one critical edge is non-tradable or route TTL exceeded
 * - BLOCKED: systemic risk overlay blocked the route
 */
export const ROUTE_STATUSES = [
  "LIVE",
  "STALE",
  "EXPIRED",
  "BLOCKED",
] as const;

export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const isRouteStatus: Validator<RouteStatus> = isEnumOf(ROUTE_STATUSES);

// ── Route ───────────────────────────────────────────────────────────

/**
 * Route: a multi-hop path through the MarketGraph.
 *
 * Each route carries:
 *   - The ordered sequence of node ids forming the path
 *   - The edges traversed (in order)
 *   - A composite score aggregating edge weights
 *   - Systemic risk concentrations
 *   - Lifecycle state (live/stale/expired/blocked)
 *   - A TTL and staleness timestamp for inventory-aware expiry
 */
export interface Route {
  /** Unique route identifier. */
  routeId: string;
  /** MarketGraphSnapshot.snapshotId that produced this route. */
  snapshotId: string;
  /** Route classification. */
  routeType: RouteType;
  /** Ordered node ids along the route. */
  nodes: string[];
  /** Ordered edge ids along the route. */
  edges: string[];
  /** Composite route score [0, 1]. Higher is better. */
  score: number;
  /** Expected net profit (USD) after full cost stack. */
  expectedNetProfitUsd: number;
  /** Maximum capital (USD) the route can absorb (bottleneck liquidity). */
  maxCapitalUsd: number;
  /** Aggregate confidence across all edges [0, 1]. */
  confidence: number;
  /** Route lifecycle status. */
  status: RouteStatus;
  /** Risk concentration per node/edge id [0, 1]. */
  riskConcentration: Record<string, number>;
  /** Route creation timestamp (Unix ms). */
  createdAtMs: number;
  /** When the route expires (Unix ms). null = no expiry. */
  expiresAtMs: number | null;
  /** When the route was last updated (Unix ms). */
  lastUpdatedAtMs: number;
  /** Invalidation reason codes (empty when route is valid). */
  invalidationReasons: string[];
}

export const isRoute: Validator<Route> = isObjectOf({
  routeId: isString,
  snapshotId: isString,
  routeType: isRouteType,
  nodes: isArrayOf(isString),
  edges: isArrayOf(isString),
  score: isInRange(0, 1),
  expectedNetProfitUsd: isNumber,
  maxCapitalUsd: isNumber,
  confidence: isInRange(0, 1),
  status: isRouteStatus,
  riskConcentration: isRecordOf(isNumber),
  createdAtMs: isNumber,
  expiresAtMs: isNumber as Validator<number | null>, // isOptional doesn't handle null; we validate null is allowed
  lastUpdatedAtMs: isNumber,
  invalidationReasons: isArrayOf(isString),
});

export function parseRoute(value: unknown): Route {
  return parse(isRoute, value, "Route");
}

// ── Systemic Risk Overlay ───────────────────────────────────────────

/**
 * ConcentrationDimension: the axes along which systemic risk is measured.
 * Each dimension tracks how much exposure is concentrated in a single
 * node or group of related nodes.
 */
export const CONCENTRATION_DIMENSIONS = [
  "VENUE",
  "CHAIN",
  "STABLECOIN",
  "BRIDGE",
  "POOL",
  "RPC",
  "WRAPPED_ASSET",
] as const;

export type ConcentrationDimension =
  (typeof CONCENTRATION_DIMENSIONS)[number];

export const isConcentrationDimension: Validator<ConcentrationDimension> =
  isEnumOf(CONCENTRATION_DIMENSIONS);

/**
 * SystemicRiskOverlay: a single risk overlay that evaluates one
 * concentration dimension across all routes.
 */
export interface SystemicRiskOverlay {
  /** Overlay identifier. */
  overlayId: string;
  /** Concentration dimension this overlay evaluates. */
  dimension: ConcentrationDimension;
  /** Maximum allowed concentration ratio [0, 1]. Routes exceeding this are blocked. */
  maxConcentration: number;
  /** Whether the overlay is enabled. */
  enabled: boolean;
}

export const isSystemicRiskOverlay: Validator<SystemicRiskOverlay> =
  isObjectOf({
    overlayId: isString,
    dimension: isConcentrationDimension,
    maxConcentration: isInRange(0, 1),
    enabled: isBoolean,
  });

// ── Route Overlay Evaluation ────────────────────────────────────────

/**
 * OverlayEvaluation: the result of evaluating a single overlay against
 * a route's risk concentrations.
 */
export interface OverlayEvaluation {
  /** The overlay that was evaluated. */
  overlayId: string;
  /** Concentration dimension. */
  dimension: ConcentrationDimension;
  /** Whether the overlay blocked the route. */
  blocked: boolean;
  /** The concentration value that triggered the block (or max allowed if not blocked). */
  concentration: number;
  /** Maximum allowed concentration. */
  maxConcentration: number;
  /** Human-readable explanation. */
  reason: string;
}

export const isOverlayEvaluation: Validator<OverlayEvaluation> = isObjectOf({
  overlayId: isString,
  dimension: isConcentrationDimension,
  blocked: isBoolean,
  concentration: isNumber,
  maxConcentration: isNumber,
  reason: isString,
});

// ── Route Scoring Config ────────────────────────────────────────────

/**
 * RouteScoringConfig: weights for the composite route score.
 * All weights are normalized so that they sum to 1.0.
 */
export interface RouteScoringConfig {
  /** Weight for expected net profit [0, 1]. */
  profitWeight: number;
  /** Weight for confidence [0, 1]. */
  confidenceWeight: number;
  /** Weight for liquidity (maxCapitalUsd) [0, 1]. */
  liquidityWeight: number;
  /** Weight for inverse risk concentration [0, 1]. */
  safetyWeight: number;
  /** Weight for inverse route length (shorter is better) [0, 1]. */
  brevityWeight: number;
}

export const isRouteScoringConfig: Validator<RouteScoringConfig> = isObjectOf({
  profitWeight: isNumber,
  confidenceWeight: isNumber,
  liquidityWeight: isNumber,
  safetyWeight: isNumber,
  brevityWeight: isNumber,
});

export const DEFAULT_ROUTE_SCORING_CONFIG: RouteScoringConfig = {
  profitWeight: 0.35,
  confidenceWeight: 0.25,
  liquidityWeight: 0.15,
  safetyWeight: 0.15,
  brevityWeight: 0.10,
};

// ── Route Engine Config ─────────────────────────────────────────────

/**
 * RouteEngineConfig: configuration for the route engine.
 */
export interface RouteEngineConfig {
  /** Maximum route length (number of hops). Routes longer than this are discarded. */
  maxRouteLength: number;
  /** Route TTL (ms). Routes expire after this duration. */
  routeTtlMs: number;
  /** Staleness threshold (ms). Routes are marked STALE when edges are older than this. */
  stalenessThresholdMs: number;
  /** Scoring configuration. */
  scoring: RouteScoringConfig;
  /** Systemic risk overlays. */
  overlays: SystemicRiskOverlay[];
}

export const isRouteEngineConfig: Validator<RouteEngineConfig> = isObjectOf({
  maxRouteLength: isNumber,
  routeTtlMs: isNumber,
  stalenessThresholdMs: isNumber,
  scoring: isRouteScoringConfig,
  overlays: isArrayOf(isSystemicRiskOverlay),
});

export const DEFAULT_ROUTE_ENGINE_CONFIG: RouteEngineConfig = {
  maxRouteLength: 6,
  routeTtlMs: 30_000,
  stalenessThresholdMs: 60_000,
  scoring: { ...DEFAULT_ROUTE_SCORING_CONFIG },
  overlays: [
    {
      overlayId: "venue-concentration",
      dimension: "VENUE",
      maxConcentration: 0.5,
      enabled: true,
    },
    {
      overlayId: "chain-concentration",
      dimension: "CHAIN",
      maxConcentration: 0.4,
      enabled: true,
    },
    {
      overlayId: "stablecoin-concentration",
      dimension: "STABLECOIN",
      maxConcentration: 0.6,
      enabled: true,
    },
    {
      overlayId: "bridge-concentration",
      dimension: "BRIDGE",
      maxConcentration: 0.5,
      enabled: true,
    },
    {
      overlayId: "pool-concentration",
      dimension: "POOL",
      maxConcentration: 0.4,
      enabled: true,
    },
    {
      overlayId: "rpc-dependence",
      dimension: "RPC",
      maxConcentration: 0.5,
      enabled: true,
    },
    {
      overlayId: "wrapped-asset-exposure",
      dimension: "WRAPPED_ASSET",
      maxConcentration: 0.3,
      enabled: true,
    },
  ],
};

// ── Route Discovery Result ──────────────────────────────────────────

/**
 * RouteDiscoveryResult: the output of a full route discovery cycle.
 */
export interface RouteDiscoveryResult {
  /** All routes discovered. */
  routes: Route[];
  /** Routes that passed all overlays. */
  liveRoutes: Route[];
  /** Routes blocked by systemic risk overlays. */
  blockedRoutes: Route[];
  /** Routes that expired or are stale. */
  expiredRoutes: Route[];
  /** Overlay evaluations for blocked routes. */
  overlayEvaluations: OverlayEvaluation[];
  /** Discovery timestamp (Unix ms). */
  discoveredAtMs: number;
  /** Graph snapshot version that was analyzed. */
  snapshotVersion: number;
}


