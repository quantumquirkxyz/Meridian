import {
  type DataQualityReport,
  type DataQualityState,
  type MarketEdge,
  type MarketGraphSnapshot,
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
  const updatedEdges = markEdgesByQuality(snapshot.edges, reports, threshold);
  return {
    ...snapshot,
    edges: updatedEdges,
  };
}


