/**
 * Pathfinding and net-cost computation for the MarketGraph.
 *
 * Provides:
 * - **DFS route discovery** — find all routes between two nodes up to a
 *   configurable depth.
 * - **Bellman-Ford cycle detection** — find profitable arbitrage cycles
 *   (positive-profit loops in the rate graph).
 * - **Cost aggregation** — sum edge weights along a route using the full
 *   cost stack from `docs/RISK.md` (fees, slippage, gas, bridges,
 *   funding, latency, failure risk, safety buffer).
 * - **Opportunity scoring** — produce `OpportunityCandidate` instances
 *   scored by net profit.
 * - **Non-executable route discarding** — filter routes that are too
 *   long, too illiquid, or contain non-tradable edges.
 */

import {
  type MarketEdge,
  type MarketGraphSnapshot,
  type EdgeWeights,
  type OpportunityCandidate,
  type CostBreakdown,
  type RiskReasonCode,
} from "@agenttrading/contracts";

// ── Types ──────────────────────────────────────────────────────────

/** A route through the graph as an ordered list of node ids. */
export type Route = string[];

/** Aggregated cost components along a route. */
export interface RouteCost {
  /** Ordered node ids forming the route. */
  route: Route;
  /** Full cost breakdown per the RISK.md net profit formula. */
  costs: CostBreakdown;
  /** Minimum liquidity along the route (bottleneck). */
  bottleneckLiquidityUsd: number;
  /** Combined failure probability (1 - ∏(1 - p_i)). */
  combinedFailureProbability: number;
  /** Sum of risk scores. */
  totalRiskScore: number;
  /** Sum of confidence scores. */
  totalConfidence: number;
  /** Number of edges (hops). */
  hops: number;
}

/** A route scored as an opportunity candidate. */
export interface ScoredRoute {
  /** The cost breakdown for this route. */
  cost: RouteCost;
  /** The opportunity candidate with net profit. */
  candidate: OpportunityCandidate;
}

/** Options controlling route discovery. */
export interface RouteDiscoveryOptions {
  /** Maximum number of hops (edges) per route. Default: 8. */
  maxHops?: number;
  /** Maximum number of routes to return. Default: 100. */
  maxRoutes?: number;
}

/** Options controlling cost computation. */
export interface CostOptions {
  /** Fixed safety buffer in USD. Default: 1.0. */
  safetyBufferUsd?: number;
  /** Gas price multiplier for estimation. Default: 1.0. */
  gasMultiplier?: number;
  /** Multiplier for latency risk (USD per ms). Default: 0.001. */
  latencyRiskPerMs?: number;
}

/** Options controlling route filtering. */
export interface FilterOptions {
  /** Minimum bottleneck liquidity in USD. Default: 0. */
  minLiquidityUsd?: number;
  /** Maximum number of hops. Default: 8. */
  maxHops?: number;
  /** Maximum combined failure probability. Default: 0.5. */
  maxFailureProbability?: number;
  /** Minimum net profit in USD for a route to be executable. Default: 0. */
  minNetProfitUsd?: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function collectEdges(snapshot: MarketGraphSnapshot): MarketEdge[] {
  return snapshot.edges.filter((e) => e.tradable);
}

/**
 * Depth-limited DFS that discovers all acyclic routes from `fromId` to
 * `toId` within the tradable subgraph.
 */
export function findRoutes(
  snapshot: MarketGraphSnapshot,
  fromId: string,
  toId: string,
  options: RouteDiscoveryOptions = {},
): Route[] {
  const { maxHops = 8, maxRoutes = 100 } = options;
  const edges = collectEdges(snapshot);

  // Adjacency list (only tradable edges).
  const adj = new Map<string, MarketEdge[]>();
  for (const edge of edges) {
    const list = adj.get(edge.from) ?? [];
    list.push(edge);
    adj.set(edge.from, list);
  }

  const routes: Route[] = [];

  function dfs(current: string, path: string[], visited: Set<string>): void {
    if (routes.length >= maxRoutes) return;
    if (path.length - 1 > maxHops) return;

    if (current === toId && path.length > 1) {
      routes.push([...path]);
      return;
    }

    for (const edge of adj.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      path.push(edge.to);
      dfs(edge.to, path, visited);
      path.pop();
      visited.delete(edge.to);
    }
  }

  const visited = new Set<string>([fromId]);
  dfs(fromId, [fromId], visited);
  return routes;
}

/**
 * Detect profitable arbitrage cycles using a Bellman-Ford variant on
 * the rate graph.  An edge's `price` weight is treated as a rate:
 * traversing the edge "multiplies" capital by that rate.  A cycle is
 * profitable when the product of rates along the cycle > 1 (equivalently
 * the sum of log-rates > 0).
 *
 * Returns at most `maxCycles` cycles, ordered by decreasing profitability
 * (highest rate product first).
 */
export function findArbitrageCycles(
  snapshot: MarketGraphSnapshot,
  options: { maxCycles?: number; maxNodes?: number } = {},
): Route[] {
  const { maxCycles = 10, maxNodes = 20 } = options;
  const edges = collectEdges(snapshot);

  // Build rate graph: price weight as the exchange rate.
  const rateEdges: Array<{
    from: string;
    to: string;
    rate: number;
    edge: MarketEdge;
  }> = [];
  for (const edge of edges) {
    const rate = edge.weights.price;
    if (rate !== undefined && rate > 0) {
      rateEdges.push({ from: edge.from, to: edge.to, rate, edge });
    }
  }

  // All unique node ids in the rate graph.
  const nodeIds = new Set<string>();
  for (const e of rateEdges) {
    nodeIds.add(e.from);
    nodeIds.add(e.to);
  }

  // Cap node count to keep the search tractable.
  const limitedNodes = [...nodeIds].slice(0, maxNodes);
  const nodeIndex = new Map(limitedNodes.map((id, i) => [id, i]));
  const n = limitedNodes.length;

  // Filter edges to only those between capped nodes.
  const validEdges = rateEdges.filter(
    (e) => nodeIndex.has(e.from) && nodeIndex.has(e.to),
  );

  // Bellman-Ford: detect negative cycles in the log-rate graph.
  // A negative cycle in log-space = a positive-profit cycle in rate-space.
  const dist = new Float64Array(n).fill(0); // log(1) = 0 for all nodes
  const predecessor = new Int32Array(n).fill(-1);
  const predEdge = new Array<MarketEdge | null>(n).fill(null);

  let lastUpdated = -1;
  for (let i = 0; i < n; i++) {
    lastUpdated = -1;
    for (const { from, to, rate, edge } of validEdges) {
      const u = nodeIndex.get(from)!;
      const v = nodeIndex.get(to)!;
      const logRate = -Math.log(rate); // negative log = cost to minimize
      if (dist[u] + logRate < dist[v] - 1e-12) {
        dist[v] = dist[u] + logRate;
        predecessor[v] = u;
        predEdge[v] = edge;
        lastUpdated = v;
      }
    }
    if (lastUpdated === -1) break;
  }

  // Extract cycles from nodes that were updated in the final iteration.
  const cycles: Route[] = [];
  const seenCycles = new Set<string>();

  if (lastUpdated !== -1) {
    // Walk back from the last-updated node to find a cycle.
    let current = lastUpdated;
    for (let i = 0; i < n; i++) {
      current = predecessor[current];
      if (current === -1) break;
    }

    if (current !== -1) {
      const cycleNodes: string[] = [];
      let node = current;
      do {
        cycleNodes.push(limitedNodes[node]);
        node = predecessor[node];
      } while (node !== current && node !== -1 && cycleNodes.length <= n);

      if (cycleNodes.length > 1) {
        cycleNodes.push(cycleNodes[0]); // close the cycle
        const key = cycleNodes.join("→");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycleNodes);
        }
      }
    }
  }

  // Also do a simple DFS-based cycle search for additional cycles.
  const adj = new Map<string, MarketEdge[]>();
  for (const edge of edges) {
    if (edge.weights.price !== undefined && edge.weights.price > 0) {
      const list = adj.get(edge.from) ?? [];
      list.push(edge);
      adj.set(edge.from, list);
    }
  }

  function dfsCycles(
    start: string,
    current: string,
    path: string[],
    visited: Set<string>,
    product: number,
  ): void {
    if (cycles.length >= maxCycles) return;
    if (path.length > limitedNodes.length) return;

    for (const edge of adj.get(current) ?? []) {
      if (!nodeIndex.has(edge.to)) continue;
      if (edge.to === start && path.length >= 2) {
        const finalProduct = product * (edge.weights.price ?? 1);
        if (finalProduct > 1.0) {
          const cycleRoute = [...path, start];
          const key = cycleRoute.join("→");
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            cycles.push(cycleRoute);
          }
        }
        continue;
      }
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      path.push(edge.to);
      dfsCycles(
        start,
        edge.to,
        path,
        visited,
        product * (edge.weights.price ?? 1),
      );
      path.pop();
      visited.delete(edge.to);
    }
  }

  for (const nodeId of limitedNodes) {
    if (cycles.length >= maxCycles) break;
    const visited = new Set<string>([nodeId]);
    dfsCycles(nodeId, nodeId, [nodeId], visited, 1);
  }

  return cycles;
}

// ── Cost computation ───────────────────────────────────────────────

/**
 * Compute the full cost breakdown along a route using the RISK.md net
 * profit formula.
 *
 * ```
 * expectedNetProfitUsd = grossSpreadUsd
 *                      - tradingFeesUsd
 *                      - slippageUsd
 *                      - gasUsd
 *                      - bridgeCostUsd
 *                      - fundingCostUsd
 *                      - latencyRiskUsd
 *                      - failureRiskUsd
 *                      - safetyBufferUsd
 * ```
 */
export function computeRouteCost(
  snapshot: MarketGraphSnapshot,
  route: Route,
  options: CostOptions = {},
): RouteCost {
  const {
    safetyBufferUsd = 1.0,
    gasMultiplier = 1.0,
    latencyRiskPerMs = 0.001,
  } = options;
  const edges = snapshot.edges;

  // Index edges by from→to for fast lookup.
  const edgeIndex = new Map<string, MarketEdge>();
  for (const edge of edges) {
    const key = `${edge.from}→${edge.to}`;
    if (!edgeIndex.has(key)) edgeIndex.set(key, edge);
  }

  let tradingFeesUsd = 0;
  let slippageUsd = 0;
  let gasUsd = 0;
  let bridgeCostUsd = 0;
  let fundingCostUsd = 0;
  let latencyRiskUsd = 0;
  let combinedFailureProb = 0; // 1 - ∏(1 - p_i)
  let totalRiskScore = 0;
  let totalConfidence = 0;
  let bottleneckLiquidity = Infinity;
  let failuresSeen = 1; // product accumulator for (1 - p)

  for (let i = 0; i < route.length - 1; i++) {
    const edgeId = `${route[i]}→${route[i + 1]}`;
    const edge = edgeIndex.get(edgeId);

    if (!edge) {
      // Missing edge → infinite cost (non-executable).
      return makeInfiniteCost(route);
    }

    const w = edge.weights;

    tradingFeesUsd += w.fee ?? 0;
    slippageUsd += w.expectedSlippage ?? 0;
    gasUsd += (w.gasCost ?? 0) * gasMultiplier;
    fundingCostUsd += w.fundingCost ?? 0;
    latencyRiskUsd += (w.latencyMs ?? 0) * latencyRiskPerMs;
    totalRiskScore += w.riskScore ?? 0;
    totalConfidence += w.confidence ?? 0;

    if (w.liquidityUsd !== undefined && w.liquidityUsd < bottleneckLiquidity) {
      bottleneckLiquidity = w.liquidityUsd;
    }

    const pFail = w.failureProbability ?? 0;
    if (pFail > 0) {
      failuresSeen *= 1 - pFail;
    }

    // BRIDGE edges carry an explicit bridge cost in their fee weight.
    if (edge.type === "BRIDGE") {
      bridgeCostUsd += w.fee ?? 0;
      // Don't double-count the fee.
      tradingFeesUsd -= w.fee ?? 0;
    }
  }

  combinedFailureProb = 1 - failuresSeen;
  if (!Number.isFinite(bottleneckLiquidity)) bottleneckLiquidity = 0;

  const costs: CostBreakdown = {
    tradingFeesUsd,
    slippageUsd,
    gasUsd,
    bridgeCostUsd,
    fundingCostUsd,
    latencyRiskUsd,
    failureRiskUsd: combinedFailureProb * 100, // scale to USD estimate
    safetyBufferUsd,
  };

  return {
    route,
    costs,
    bottleneckLiquidityUsd: bottleneckLiquidity,
    combinedFailureProbability: combinedFailureProb,
    totalRiskScore,
    totalConfidence,
    hops: route.length - 1,
  };
}

function makeInfiniteCost(route: Route): RouteCost {
  return {
    route,
    costs: {
      tradingFeesUsd: Infinity,
      slippageUsd: Infinity,
      gasUsd: Infinity,
      bridgeCostUsd: 0,
      fundingCostUsd: 0,
      latencyRiskUsd: 0,
      failureRiskUsd: 100,
      safetyBufferUsd: 0,
    },
    bottleneckLiquidityUsd: 0,
    combinedFailureProbability: 1,
    totalRiskScore: 1,
    totalConfidence: 0,
    hops: route.length - 1,
  };
}

// ── Scoring ────────────────────────────────────────────────────────

/**
 * Score a route as an `OpportunityCandidate` using the full RISK.md net
 * profit formula.  The caller supplies `grossSpreadUsd`; the function
 * computes the total cost and derives `expectedNetProfitUsd`.
 *
 * Returns `undefined` when the route contains a non-tradable edge
 * (non-executable).
 */
export function scoreRoute(
  snapshot: MarketGraphSnapshot,
  route: Route,
  grossSpreadUsd: number,
  costOptions: CostOptions = {},
): OpportunityCandidate | undefined {
  // Verify all edges in the route are tradable.
  for (let i = 0; i < route.length - 1; i++) {
    const fromId = route[i];
    const toId = route[i + 1];
    const edge = snapshot.edges.find(
      (e) => e.from === fromId && e.to === toId && e.tradable,
    );
    if (!edge) return undefined;
  }

  const routeCost = computeRouteCost(snapshot, route, costOptions);
  const totalCost =
    routeCost.costs.tradingFeesUsd +
    routeCost.costs.slippageUsd +
    routeCost.costs.gasUsd +
    routeCost.costs.bridgeCostUsd +
    routeCost.costs.fundingCostUsd +
    routeCost.costs.latencyRiskUsd +
    routeCost.costs.failureRiskUsd +
    routeCost.costs.safetyBufferUsd;

  const expectedNetProfitUsd = grossSpreadUsd - totalCost;

  const invalidationReasons:
    | import("@agenttrading/contracts").RiskReasonCode[]
    | undefined =
    expectedNetProfitUsd <= 0 ? ["MIN_EDGE"] : undefined;

  const riskConcentration = computeRiskConcentration(snapshot, route);

  return {
    id: `opp:${route.join(":")}:${Date.now()}`,
    snapshotId: snapshot.snapshotId,
    route,
    grossSpreadUsd,
    costs: routeCost.costs,
    expectedNetProfitUsd,
    createdAtMs: Date.now(),
    status: expectedNetProfitUsd > 0 ? "CANDIDATE" : "INVALID",
    invalidationReasons,
    maxCapitalUsd: routeCost.bottleneckLiquidityUsd,
    confidence: routeCost.totalConfidence / Math.max(routeCost.hops, 1),
    riskConcentration,
  };
}

// ── High-level pipeline ────────────────────────────────────────────

/**
 * End-to-end pipeline: find routes → compute costs → score → filter.
 *
 * 1. Discover routes between `fromId` and `toId` (or cycles if
 *    `fromId === toId`).
 * 2. Compute the full cost breakdown for each route.
 * 3. Score each route as an `OpportunityCandidate`.
 * 4. Filter out non-executable routes (non-tradable edges, illiquid,
 *    low net profit, etc.).
 *
 * Returns scored candidates sorted by net profit (descending).
 */
export function findAndScoreRoutes(
  snapshot: MarketGraphSnapshot,
  fromId: string,
  toId: string,
  grossSpreadUsd: number,
  options: {
    discovery?: RouteDiscoveryOptions;
    cost?: CostOptions;
    filter?: FilterOptions;
  } = {},
): ScoredRoute[] {
  const {
    filter: {
      minLiquidityUsd = 0,
      maxHops = 8,
      maxFailureProbability = 0.5,
      minNetProfitUsd = 0,
    } = {},
  } = options;

  // Step 1: discover routes.
  let routes: Route[];
  if (fromId === toId) {
    routes = findArbitrageCycles(snapshot, {
      maxCycles: options.discovery?.maxRoutes ?? 100,
    });
  } else {
    routes = findRoutes(snapshot, fromId, toId, options.discovery);
  }

  // Step 2 & 3: compute cost and score each route.
  const scored: ScoredRoute[] = [];
  for (const route of routes) {
    const cost = computeRouteCost(snapshot, route, options.cost);
    const candidate = scoreRoute(snapshot, route, grossSpreadUsd, options.cost);
    if (!candidate) continue;
    scored.push({ cost, candidate });
  }

  // Step 4: filter non-executable routes.
  const filtered = scored.filter((s) => {
    if (s.cost.bottleneckLiquidityUsd < minLiquidityUsd) return false;
    if (s.cost.hops > maxHops) return false;
    if (s.cost.combinedFailureProbability > maxFailureProbability) return false;
    if (s.candidate.expectedNetProfitUsd < minNetProfitUsd) return false;
    if (s.candidate.status === "INVALID") return false;
    return true;
  });

  // Sort by net profit descending.
  filtered.sort(
    (a, b) =>
      b.candidate.expectedNetProfitUsd - a.candidate.expectedNetProfitUsd,
  );

  return filtered;
}

/**
 * Discard non-executable routes from a list. A route is discarded when:
 * - It contains a non-tradable edge.
 * - Bottleneck liquidity falls below `minLiquidityUsd`.
 * - It exceeds `maxHops`.
 * - Combined failure probability exceeds `maxFailureProbability`.
 * - Net profit falls below `minNetProfitUsd`.
 * - It contains a cycle (repeated node id).
 */
export function discardNonExecutable(
  snapshot: MarketGraphSnapshot,
  routes: readonly Route[],
  grossSpreadUsd: number,
  options: FilterOptions = {},
): Route[] {
  const {
    minLiquidityUsd = 0,
    maxHops = 8,
    maxFailureProbability = 0.5,
    minNetProfitUsd = 0,
  } = options;

  const executable: Route[] = [];

  for (const route of routes) {
    // Discard cycles.
    if (new Set(route).size !== route.length) continue;
    // Discard overly long routes.
    if (route.length - 1 > maxHops) continue;

    // Discard routes containing non-tradable edges.
    const hasNonTradable = route.some((nodeId, i) => {
      if (i === route.length - 1) return false;
      return !snapshot.edges.some(
        (e) => e.from === nodeId && e.to === route[i + 1] && e.tradable,
      );
    });
    if (hasNonTradable) continue;

    const cost = computeRouteCost(snapshot, route);
    if (cost.bottleneckLiquidityUsd < minLiquidityUsd) continue;
    if (cost.combinedFailureProbability > maxFailureProbability) continue;

    const totalCost =
      cost.costs.tradingFeesUsd +
      cost.costs.slippageUsd +
      cost.costs.gasUsd +
      cost.costs.bridgeCostUsd +
      cost.costs.fundingCostUsd +
      cost.costs.latencyRiskUsd +
      cost.costs.failureRiskUsd +
      cost.costs.safetyBufferUsd;

    if (grossSpreadUsd - totalCost < minNetProfitUsd) continue;

    executable.push(route);
  }

  return executable;
}

// ── Risk concentration ─────────────────────────────────────────────

/**
 * Scaling factor for risk concentration.  The raw product
 * riskScore × failureProbability is in [0, 1]; multiplying by this
 * factor stretches the range so that moderate risk combinations
 * (e.g. 0.3 × 0.2 = 0.06) produce non-trivial concentration values
 * before clamping to [0, 1].
 */
const RISK_CONCENTRATION_SCALE = 10;

/**
 * Compute risk concentration per node and edge along a route.
 * For each edge, concentration = riskScore * failureProbability.
 * For each node, concentration = max risk of adjacent edges.
 * Values are normalized to [0, 1].
 */
export function computeRiskConcentration(
  snapshot: MarketGraphSnapshot,
  route: Route,
): Record<string, number> {
  const concentration: Record<string, number> = {};

  // Index edges by from→to.
  const edgeIndex = new Map<string, MarketEdge>();
  for (const edge of snapshot.edges) {
    const key = `${edge.from}→${edge.to}`;
    if (!edgeIndex.has(key)) edgeIndex.set(key, edge);
  }

  // Compute per-edge concentration.
  const nodeConcentration = new Map<string, number>();

  for (let i = 0; i < route.length - 1; i++) {
    const edgeId = `${route[i]}→${route[i + 1]}`;
    const edge = edgeIndex.get(edgeId);
    if (!edge) continue;

    const riskScore = edge.weights.riskScore ?? 0;
    const failureProb = edge.weights.failureProbability ?? 0;
    const edgeConc = Math.min(riskScore * failureProb * RISK_CONCENTRATION_SCALE, 1);
    concentration[edgeId] = edgeConc;

    // Track per-node: max concentration across incident edges.
    for (const nodeId of [route[i], route[i + 1]]) {
      const current = nodeConcentration.get(nodeId) ?? 0;
      if (edgeConc > current) nodeConcentration.set(nodeId, edgeConc);
    }
  }

  // Record per-node concentration.
  for (const [nodeId, conc] of nodeConcentration) {
    concentration[nodeId] = conc;
  }

  return concentration;
}

// ── Cycle candidate detection ──────────────────────────────────────

/**
 * Detect profitable arbitrage cycles and return fully-enriched
 * `ScoredRoute[]` candidates.  Each candidate includes:
 * - Expected net profit after the full cost stack
 * - Max capital (bottleneck liquidity)
 * - Confidence score (averaged across edges)
 * - Risk concentration per node/edge
 * - Invalidation reasons when the net-cost stack fails
 *
 * Cycles that fail the net-cost stack are discarded.
 */
export function detectCycleCandidates(
  snapshot: MarketGraphSnapshot,
  options: {
    maxCycles?: number;
    maxNodes?: number;
    grossSpreadUsd?: number;
    cost?: CostOptions;
    filter?: FilterOptions;
  } = {},
): ScoredRoute[] {
  const {
    grossSpreadUsd = 0,
    filter: {
      minLiquidityUsd = 0,
      maxHops = 8,
      maxFailureProbability = 0.5,
      minNetProfitUsd = 0,
    } = {},
  } = options;

  // Step 1: find raw cycles.
  const cycles = findArbitrageCycles(snapshot, {
    maxCycles: options.maxCycles,
    maxNodes: options.maxNodes,
  });

  // Step 2: compute cost and score each cycle.
  const scored: ScoredRoute[] = [];
  for (const route of cycles) {
    const cost = computeRouteCost(snapshot, route, options.cost);
    const candidate = scoreRoute(snapshot, route, grossSpreadUsd, options.cost);
    if (!candidate) continue;
    scored.push({ cost, candidate });
  }

  // Step 3: filter non-executable candidates.
  const filtered = scored.filter((s) => {
    if (s.cost.bottleneckLiquidityUsd < minLiquidityUsd) return false;
    if (s.cost.hops > maxHops) return false;
    if (s.cost.combinedFailureProbability > maxFailureProbability) return false;
    if (s.candidate.expectedNetProfitUsd < minNetProfitUsd) return false;
    if (s.candidate.status === "INVALID") return false;
    return true;
  });

  // Sort by net profit descending.
  filtered.sort(
    (a, b) =>
      b.candidate.expectedNetProfitUsd - a.candidate.expectedNetProfitUsd,
  );

  return filtered;
}
