import {
  type DataQualityReport,
  type DataQualityState,
  type MarketEdge,
  type MarketGraphSnapshot,
  isStateAtLeast,
  markEdgesByQuality,
} from "@agenttrading/contracts";

/**
 * Applies data quality reports to a MarketGraphSnapshot, marking edges from
 * degraded or worse sources as non-tradable (issue #18 AC3).
 *
 * Acceptance criteria:
 * - Graph edges from degraded sources become non-tradable.
 *
 * Returns a new snapshot with the updated edges (immutable — the original
 * is not mutated).
 */
export function applyDataQualityToGraph(
  snapshot: MarketGraphSnapshot,
  reports: readonly DataQualityReport[],
  threshold: DataQualityState = "DEGRADED",
): MarketGraphSnapshot {
  const updatedEdges = markEdgesFromSources(snapshot.edges, reports, threshold);
  return {
    ...snapshot,
    edges: updatedEdges,
  };
}

/**
 * Marks edges as non-tradable when their source is at least as restrictive
 * as the given threshold. Pure function — returns new edge array.
 */
export function markEdgesFromSources(
  edges: readonly MarketEdge[],
  reports: readonly DataQualityReport[],
  threshold: DataQualityState = "DEGRADED",
): MarketEdge[] {
  return markEdgesByQuality(edges, reports, threshold);
}

/**
 * Returns the set of source ids that are feeding edges in the graph.
 */
export function graphSourceIds(snapshot: MarketGraphSnapshot): string[] {
  return [...new Set(snapshot.edges.map((e) => e.source))];
}

/**
 * Returns edges that are tradable.
 */
export function tradableEdges(snapshot: MarketGraphSnapshot): MarketEdge[] {
  return snapshot.edges.filter((e) => e.tradable);
}

/**
 * Returns edges that are non-tradable.
 */
export function nonTradableEdges(snapshot: MarketGraphSnapshot): MarketEdge[] {
  return snapshot.edges.filter((e) => !e.tradable);
}
