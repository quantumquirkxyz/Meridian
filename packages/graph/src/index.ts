/**
 * @agenttrading/graph — MarketGraph engine: nodes/edges, versioned snapshots,
 * pathfinding, cycle detection, net-cost routing. Depends only on contracts.
 */
export const GRAPH_VERSION = "0.1.0";

export {
  applyDataQualityToGraph,
} from "./quality.ts";

export { MarketGraph } from "./market-graph.ts";
export { GraphEventProcessor } from "./graph-event-processor.ts";

export {
  findRoutes,
  findArbitrageCycles,
  computeRouteCost,
  scoreRoute,
  findAndScoreRoutes,
  discardNonExecutable,
} from "./pathfinding.ts";

export type {
  Route,
  RouteCost,
  ScoredRoute,
  RouteDiscoveryOptions,
  CostOptions,
  FilterOptions,
} from "./pathfinding.ts";
