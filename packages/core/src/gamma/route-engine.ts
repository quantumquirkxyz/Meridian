/**
 * RouteEngine: graph-scale route discovery, scoring, and lifecycle
 * management (issue #37).
 *
 * Acceptance criteria:
 *   AC1: Live routes detected across CEX-CEX, DEX-DEX, CEX-DEX,
 *        cross-chain, funding basis.
 *   AC2: Systemic risk overlays block routes with excessive concentration
 *        or risk.
 *   AC3: Inventory-aware routing uses capital location; routes expire
 *        when stale.
 *   AC4: Route invalidation prevents executing on dead routes.
 *
 * The engine is deterministic — no LLM, no I/O. It discovers routes
 * from a MarketGraphSnapshot, scores them, applies systemic risk
 * overlays, and tracks their lifecycle (live → stale → expired).
 *
 * The route engine sits between UPDATE_MARKET_GRAPH and
 * DETECT_OPPORTUNITY in the StateGraph flow. It enriches the graph
 * snapshot with scored, risk-evaluated routes that the opportunity
 * scanner can consume.
 */

import type {
  MarketEdge,
  MarketGraphSnapshot,
  MarketNode,
  OpportunityCandidate,
  OverlayEvaluation,
  Route,
  RouteDiscoveryResult,
  RouteEngineConfig,
  RouteReasonCode,
  RouteScoringConfig,
  RouteStatus,
  RouteType,
} from "@agenttrading/contracts";
import { DEFAULT_ROUTE_ENGINE_CONFIG } from "@agenttrading/contracts";
import {
  SystemicRiskOverlayEngine,
} from "./systemic-risk-overlay.ts";

// ── Helpers ─────────────────────────────────────────────────────────

/** Generate a deterministic route id from its nodes. */
function routeId(nodes: string[]): string {
  return `route-${nodes.join(">")}`;
}

/** Compute a composite score from route attributes. */
function computeScore(
  expectedNetProfitUsd: number,
  confidence: number,
  maxCapitalUsd: number,
  avgRiskConcentration: number,
  routeLength: number,
  maxRouteLength: number,
  scoring: RouteScoringConfig,
): number {
  // Normalize each component to [0, 1].
  // Profit: use sigmoid-like scaling. $0 → 0, $100+ → ~1.
  const profitNorm = Math.min(1, expectedNetProfitUsd / 100);

  // Confidence is already [0, 1].
  const confidenceNorm = confidence;

  // Liquidity: use log scaling. $0 → 0, $1M+ → ~1.
  const liquidityNorm = maxCapitalUsd > 0
    ? Math.min(1, Math.log10(maxCapitalUsd + 1) / 6) // log10(1M) = 6
    : 0;

  // Safety: inverse concentration. 0 concentration → 1, 1 → 0.
  const safetyNorm = 1 - avgRiskConcentration;

  // Brevity: shorter routes are better. 2 hops → 1, maxRouteLength → ~0.
  const brevityNorm = routeLength <= 1
    ? 1
    : Math.max(0, 1 - (routeLength - 2) / Math.max(1, maxRouteLength - 2));

  const raw =
    profitNorm * scoring.profitWeight +
    confidenceNorm * scoring.confidenceWeight +
    liquidityNorm * scoring.liquidityWeight +
    safetyNorm * scoring.safetyWeight +
    brevityNorm * scoring.brevityWeight;

  // Clamp to [0, 1].
  return Math.max(0, Math.min(1, raw));
}

/** Compute average risk concentration from a concentration map. */
function avgConcentration(concentrations: Record<string, number>): number {
  const values = Object.values(concentrations);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Classify a route's type based on the nodes and edges it traverses.
 */
function classifyRouteType(
  nodes: readonly MarketNode[],
  edges: readonly MarketEdge[],
): RouteType {
  const nodeTypes = new Set(nodes.map((n) => n.type));
  const edgeTypes = new Set(edges.map((e) => e.type));

  // Funding basis: route exploits FUNDING edges.
  if (edgeTypes.has("FUNDING")) {
    return "FUNDING_BASIS";
  }

  // Cross-chain: route traverses a BRIDGE edge.
  if (edgeTypes.has("BRIDGE")) {
    return "CROSS_CHAIN";
  }

  // CEX-CEX: only VENUE nodes with ORDER_BOOK edges.
  if (
    nodeTypes.has("VENUE") &&
    !nodeTypes.has("POOL") &&
    edgeTypes.has("ORDER_BOOK") &&
    !edgeTypes.has("SWAP") &&
    !edgeTypes.has("BRIDGE")
  ) {
    return "CEX_CEX";
  }

  // DEX-DEX: only POOL nodes with SWAP edges.
  if (
    nodeTypes.has("POOL") &&
    !nodeTypes.has("VENUE") &&
    edgeTypes.has("SWAP") &&
    !edgeTypes.has("ORDER_BOOK")
  ) {
    return "DEX_DEX";
  }

  // CEX-DEX: mix of VENUE and POOL nodes.
  if (nodeTypes.has("VENUE") && nodeTypes.has("POOL")) {
    return "CEX_DEX";
  }

  // Default: if we have ORDER_BOOK it's CEX-like, otherwise DEX-like.
  if (edgeTypes.has("ORDER_BOOK")) {
    return "CEX_CEX";
  }
  return "DEX_DEX";
}

// ── Route Engine ────────────────────────────────────────────────────

/**
 * RouteEngine: the complete route discovery and lifecycle engine.
 *
 * Discovers multi-hop routes from a MarketGraphSnapshot, scores them,
 * applies systemic risk overlays, and tracks lifecycle state.
 *
 * Usage:
 * ```ts
 * const engine = new RouteEngine();
 * const result = engine.discover(snapshot, nowMs);
 * const liveRoutes = result.liveRoutes;
 * // Feed live routes into the opportunity scanner.
 * ```
 */
export class RouteEngine {
  private readonly config: RouteEngineConfig;
  private readonly overlayEngine: SystemicRiskOverlayEngine;
  private readonly now: () => number;

  /** Active routes keyed by routeId. */
  private readonly activeRoutes = new Map<string, Route>();

  constructor(
    config: RouteEngineConfig = DEFAULT_ROUTE_ENGINE_CONFIG,
    now?: () => number,
  ) {
    this.config = { ...config };
    this.now = now ?? (() => Date.now());
    this.overlayEngine = new SystemicRiskOverlayEngine(config);
  }

  // ── AC1: Live route detection ──────────────────────────────────

  /**
   * Discover routes from a MarketGraphSnapshot.
   *
   * This performs a bounded DFS from every source node, finding all
   * paths up to maxRouteLength hops. Each path is classified, scored,
   * and evaluated against systemic risk overlays.
   *
   * Returns a RouteDiscoveryResult containing live, blocked, and
   * expired routes.
   */
  discover(
    snapshot: MarketGraphSnapshot,
    nowMs?: number,
  ): RouteDiscoveryResult {
    const now = nowMs ?? this.now();
    const routes: Route[] = [];
    const blockedRoutes: Route[] = [];
    const expiredRoutes: Route[] = [];
    const liveRoutes: Route[] = [];
    const overlayEvaluations: OverlayEvaluation[] = [];

    // Build adjacency list from edges.
    const adjacency = buildAdjacency(snapshot);

    // Find all paths from every source node.
    const foundPaths = new Set<string>();
    for (const node of snapshot.nodes) {
      const paths = findPaths(
        node.id,
        adjacency,
        this.config.maxRouteLength,
        snapshot,
      );
      for (const path of paths) {
        const key = path.nodes.join(">");
        if (foundPaths.has(key)) continue;
        foundPaths.add(key);

        // Resolve the edges for this path.
        const pathEdges = resolveEdges(path.edges, snapshot);
        if (pathEdges.length === 0) continue;

        // Skip trivial single-edge paths (those are raw swaps, not routes).
        if (pathEdges.length < 1) continue;

        // Classify the route type.
        const pathNodes = resolveNodes(path.nodes, snapshot);
        const routeType = classifyRouteType(pathNodes, pathEdges);

        // Compute route metrics from edge weights.
        const { expectedNetProfitUsd, confidence, maxCapitalUsd, riskConcentration } =
          aggregateEdgeWeights(pathEdges);

        // Enrich riskConcentration with dimension-prefixed keys from node metadata.
        // This enables systemic risk overlays to evaluate concentration per
        // venue, chain, pool, etc.
        enrichConcentrationFromNodes(pathNodes, riskConcentration);

        // Score the route.
        const score = computeScore(
          expectedNetProfitUsd,
          confidence,
          maxCapitalUsd,
          avgConcentration(riskConcentration),
          pathEdges.length,
          this.config.maxRouteLength,
          this.config.scoring,
        );

        // Determine initial status.
        // Staleness is measured from the snapshot's creation time.
        const snapshotAge = now - snapshot.createdAtMs;
        const isStale = snapshotAge > this.config.stalenessThresholdMs;
        const allTradable = pathEdges.every((e) => e.tradable);

        let status: RouteStatus;
        if (!allTradable) {
          status = "EXPIRED";
        } else if (isStale) {
          status = "STALE";
        } else {
          status = "LIVE";
        }

        // Build the route.
        const id = routeId(path.nodes);
        const route: Route = {
          routeId: id,
          snapshotId: snapshot.snapshotId,
          routeType,
          nodes: [...path.nodes],
          edges: [...path.edges],
          score,
          expectedNetProfitUsd,
          maxCapitalUsd,
          confidence,
          status,
          riskConcentration,
          createdAtMs: now,
          expiresAtMs: status === "LIVE" ? now + this.config.routeTtlMs : null,
          lastUpdatedAtMs: now,
          invalidationReasons: [],
        };

        // Apply systemic risk overlays (AC2).
        const evaluations = this.overlayEngine.evaluateRoute(route);
        overlayEvaluations.push(...evaluations);

        if (evaluations.some((e) => e.blocked)) {
          route.status = "BLOCKED";
          route.invalidationReasons = [
            ...evaluations
              .filter((e) => e.blocked)
              .map((e) => `ROUTE_BLOCKED:${e.dimension}`),
          ];
        }

        // Apply score threshold.
        if (route.status === "LIVE" && route.score < 0.1) {
          route.status = "EXPIRED";
          route.invalidationReasons.push("ROUTE_SCORE_LOW");
        }

        // Categorize the route.
        switch (route.status) {
          case "LIVE":
            liveRoutes.push(route);
            break;
          case "BLOCKED":
            blockedRoutes.push(route);
            break;
          case "EXPIRED":
          case "STALE":
            expiredRoutes.push(route);
            break;
        }

        routes.push(route);
      }
    }

    // Update active routes cache.
    this.activeRoutes.clear();
    for (const route of liveRoutes) {
      this.activeRoutes.set(route.routeId, route);
    }

    return {
      routes,
      liveRoutes,
      blockedRoutes,
      expiredRoutes,
      overlayEvaluations,
      discoveredAtMs: now,
      snapshotVersion: snapshot.version,
    };
  }

  // ── AC3: Inventory-aware routing ───────────────────────────────

  /**
   * Check whether a route is still valid given the current inventory.
   * A route is inventory-aware when:
   *   - Its maxCapitalUsd does not exceed available capital at the route's
   *     source node
   *   - The route's score remains above the minimum threshold
   *   - The route has not expired
   *
   * @param routeId - The route to check.
   * @param availableCapitalUsd - Available capital at the route's source.
   * @param nowMs - Current timestamp.
   */
  isRouteValidForInventory(
    routeId: string,
    availableCapitalUsd: number,
    nowMs?: number,
  ): { valid: boolean; reason?: string } {
    const now = nowMs ?? this.now();
    const route = this.activeRoutes.get(routeId);

    if (route === undefined) {
      return { valid: false, reason: "route not found in active routes" };
    }

    // Check expiry (AC3: routes expire when stale).
    if (route.expiresAtMs !== null && now > route.expiresAtMs) {
      route.status = "EXPIRED";
      route.invalidationReasons.push("ROUTE_EXPIRED");
      return { valid: false, reason: "route expired" };
    }

    // Check staleness.
    if (now - route.lastUpdatedAtMs > this.config.stalenessThresholdMs) {
      route.status = "STALE";
      route.invalidationReasons.push("ROUTE_STALE");
      return { valid: false, reason: "route stale" };
    }

    // Check inventory: available capital must cover the route's maxCapitalUsd.
    if (availableCapitalUsd < route.maxCapitalUsd * 0.1) {
      // Less than 10% of maxCapitalUsd available — route is not viable.
      return {
        valid: false,
        reason: `insufficient capital: $${availableCapitalUsd.toFixed(2)} available, route needs at least $${(route.maxCapitalUsd * 0.1).toFixed(2)}`,
      };
    }

    return { valid: true };
  }

  // ── AC4: Route invalidation ────────────────────────────────────

  /**
   * Invalidate a route, preventing it from being used for execution.
   *
   * A route can be invalidated when:
   *   - An edge becomes non-tradable
   *   - Liquidity evaporates (maxCapitalUsd drops below minimum)
   *   - A hidden correlation is detected
   *   - The systemic risk overlay blocks it
   *
   * @param routeId - The route to invalidate.
   * @param reason - The invalidation reason code.
   * @param nowMs - Current timestamp.
   */
  invalidate(
    routeId: string,
    reason: RouteReasonCode,
    nowMs?: number,
  ): boolean {
    const now = nowMs ?? this.now();
    const route = this.activeRoutes.get(routeId);

    if (route === undefined) {
      return false;
    }

    route.status = "EXPIRED";
    route.invalidationReasons.push(reason);
    route.lastUpdatedAtMs = now;
    this.activeRoutes.delete(routeId);
    return true;
  }

  /**
   * Check all active routes for invalidation conditions.
   *
   * This should be called periodically (e.g., on each graph snapshot
   * update) to expire stale routes and block routes whose edges have
   * gone non-tradable.
   *
   * @param snapshot - The latest market graph snapshot.
   * @param nowMs - Current timestamp.
   * @returns Routes that were invalidated in this sweep.
   */
  sweepInvalidate(
    snapshot: MarketGraphSnapshot,
    nowMs?: number,
  ): Route[] {
    const now = nowMs ?? this.now();
    const invalidated: Route[] = [];

    // Build a lookup of tradable edge ids from the current snapshot.
    const tradableEdges = new Set(
      snapshot.edges.filter((e) => e.tradable).map((e) => e.id),
    );

    for (const [routeId, route] of this.activeRoutes) {
      // Check TTL expiry.
      if (route.expiresAtMs !== null && now > route.expiresAtMs) {
        this.invalidate(routeId, "ROUTE_EXPIRED", now);
        invalidated.push(route);
        continue;
      }

      // Check staleness.
      if (now - route.lastUpdatedAtMs > this.config.stalenessThresholdMs) {
        this.invalidate(routeId, "ROUTE_STALE", now);
        invalidated.push(route);
        continue;
      }

      // Check edge tradability (AC4: dead routes are invalidated).
      const deadEdges = route.edges.filter((e) => !tradableEdges.has(e));
      if (deadEdges.length > 0) {
        this.invalidate(routeId, "LIQUIDITY_EVAPORATED", now);
        invalidated.push(route);
        continue;
      }

      // Re-evaluate systemic risk overlays.
      if (this.overlayEngine.isBlocked(route)) {
        this.invalidate(routeId, "ROUTE_BLOCKED", now);
        invalidated.push(route);
        continue;
      }
    }

    return invalidated;
  }

  /**
   * Get all currently active (live) routes.
   */
  getActiveRoutes(): readonly Route[] {
    return [...this.activeRoutes.values()];
  }

  /**
   * Get a specific active route by id.
   */
  getRoute(routeId: string): Route | undefined {
    return this.activeRoutes.get(routeId);
  }

  /**
   * Get the number of active routes.
   */
  activeRouteCount(): number {
    return this.activeRoutes.size;
  }

  /**
   * Get the engine config.
   */
  getConfig(): RouteEngineConfig {
    return { ...this.config };
  }

  /**
   * Get the systemic risk overlay engine.
   */
  getOverlayEngine(): SystemicRiskOverlayEngine {
    return this.overlayEngine;
  }
}

// ── Graph traversal helpers ─────────────────────────────────────────

interface AdjacencyEntry {
  nodeId: string;
  edgeId: string;
}

interface PathResult {
  nodes: string[];
  edges: string[];
}

/** Build an adjacency list from a graph snapshot. */
function buildAdjacency(
  snapshot: MarketGraphSnapshot,
): Map<string, AdjacencyEntry[]> {
  const adjacency = new Map<string, AdjacencyEntry[]>();

  for (const node of snapshot.nodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of snapshot.edges) {
    const list = adjacency.get(edge.from);
    if (list !== undefined) {
      list.push({ nodeId: edge.to, edgeId: edge.id });
    }
  }

  return adjacency;
}

/** Find all paths from a source node up to maxHops. */
function findPaths(
  sourceId: string,
  adjacency: Map<string, AdjacencyEntry[]>,
  maxHops: number,
  snapshot: MarketGraphSnapshot,
): PathResult[] {
  const results: PathResult[] = [];

  function dfs(
    currentId: string,
    visited: Set<string>,
    pathNodes: string[],
    pathEdges: string[],
    depth: number,
  ): void {
    if (depth > maxHops) return;

    // Record the current path (if it has at least 1 edge).
    if (pathEdges.length > 0) {
      results.push({
        nodes: [...pathNodes],
        edges: [...pathEdges],
      });
    }

    // Don't explore further if at max hops.
    if (depth === maxHops) return;

    const neighbors = adjacency.get(currentId) ?? [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor.nodeId)) continue; // no cycles

      visited.add(neighbor.nodeId);
      pathNodes.push(neighbor.nodeId);
      pathEdges.push(neighbor.edgeId);

      dfs(neighbor.nodeId, visited, pathNodes, pathEdges, depth + 1);

      pathNodes.pop();
      pathEdges.pop();
      visited.delete(neighbor.nodeId);
    }
  }

  const visited = new Set<string>([sourceId]);
  dfs(sourceId, visited, [sourceId], [], 0);

  return results;
}

/** Resolve edge ids to MarketEdge objects. */
function resolveEdges(
  edgeIds: string[],
  snapshot: MarketGraphSnapshot,
): MarketEdge[] {
  const edgeMap = new Map(snapshot.edges.map((e) => [e.id, e]));
  return edgeIds.map((id) => edgeMap.get(id)).filter((e): e is MarketEdge => e !== undefined);
}

/** Resolve node ids to MarketNode objects. */
function resolveNodes(
  nodeIds: string[],
  snapshot: MarketGraphSnapshot,
): MarketNode[] {
  const nodeMap = new Map(snapshot.nodes.map((n) => [n.id, n]));
  return nodeIds.map((id) => nodeMap.get(id)).filter((n): n is MarketNode => n !== undefined);
}

/** Aggregate edge weights into route-level metrics. */
function aggregateEdgeWeights(edges: readonly MarketEdge[]): {
  expectedNetProfitUsd: number;
  confidence: number;
  maxCapitalUsd: number;
  riskConcentration: Record<string, number>;
} {
  if (edges.length === 0) {
    return {
      expectedNetProfitUsd: 0,
      confidence: 1,
      maxCapitalUsd: 0,
      riskConcentration: {},
    };
  }

  // Expected profit: minimum edge price spread (bottleneck model).
  // We use the minimum edge profit as the route's limiting factor.
  let minProfit = Infinity;
  let totalFees = 0;
  let totalSlippage = 0;
  let totalGas = 0;
  let totalFunding = 0;

  for (const edge of edges) {
    const w = edge.weights;

    // Each edge contributes a spread: price - fee - slippage - gas - funding.
    const price = w.price ?? 0;
    const fee = w.fee ?? 0;
    const slippage = w.expectedSlippage ?? 0;
    const gas = w.gasCost ?? 0;
    const funding = w.fundingCost ?? 0;

    totalFees += fee;
    totalSlippage += slippage;
    totalGas += gas;
    totalFunding += funding;

    const edgeProfit = price - fee - slippage - gas - funding;
    if (edgeProfit < minProfit) {
      minProfit = edgeProfit;
    }
  }

  // Use the minimum edge profit as the route's expected net profit.
  // In practice, the route's profit is limited by the tightest edge.
  const expectedNetProfitUsd = minProfit === Infinity ? 0 : minProfit;

  // Confidence: product of all edge confidences.
  let confidence = 1;
  for (const edge of edges) {
    const c = edge.weights.confidence ?? 0.5;
    confidence *= c;
  }

  // Max capital: minimum liquidity across all edges (bottleneck).
  let maxCapitalUsd = Infinity;
  for (const edge of edges) {
    const liq = edge.weights.liquidityUsd ?? Infinity;
    if (liq < maxCapitalUsd) {
      maxCapitalUsd = liq;
    }
  }
  if (maxCapitalUsd === Infinity) maxCapitalUsd = 0;

  // Risk concentration: aggregate per-edge risk scores.
  const riskConcentration: Record<string, number> = {};
  for (const edge of edges) {
    if (edge.weights.riskScore !== undefined) {
      riskConcentration[edge.id] = edge.weights.riskScore;
    }
    if (edge.weights.failureProbability !== undefined) {
      riskConcentration[`${edge.id}:failure`] = edge.weights.failureProbability;
    }
  }

  return {
    expectedNetProfitUsd,
    confidence,
    maxCapitalUsd,
    riskConcentration,
  };
}

/**
 * Enrich a risk concentration map with dimension-prefixed keys from node
 * metadata. This enables systemic risk overlays to evaluate concentration
 * per venue, chain, pool, etc.
 *
 * Node types map to concentration dimensions:
 *   - VENUE → VENUE:nodeId
 *   - CHAIN → CHAIN:nodeId
 *   - POOL  → POOL:nodeId
 *   - ASSET → may be wrapped asset if metadata.wrapped === true
 *
 * The node's meta field may also carry explicit concentration values
 * under a `concentration` key.
 */
function enrichConcentrationFromNodes(
  nodes: readonly MarketNode[],
  riskConcentration: Record<string, number>,
): void {
  for (const node of nodes) {
    // Map node type to concentration dimension.
    let dimension: string | null = null;
    switch (node.type) {
      case "VENUE":
        dimension = "VENUE";
        break;
      case "CHAIN":
        dimension = "CHAIN";
        break;
      case "POOL":
        dimension = "POOL";
        break;
      case "ASSET":
        // Check if this is a wrapped asset.
        if (node.meta?.["wrapped"] === true) {
          dimension = "WRAPPED_ASSET";
        }
        break;
      default:
        break;
    }

    if (dimension === null) continue;

    const key = `${dimension}:${node.id}`;

    // Use explicit concentration from metadata if available,
    // otherwise use a default base concentration.
    if (node.meta?.["concentration"] !== undefined) {
      const val = node.meta["concentration"];
      if (typeof val === "number") {
        riskConcentration[key] = Math.max(
          riskConcentration[key] ?? 0,
          val,
        );
      }
    } else {
      // Each node contributes a base concentration of 1/n where n is the
      // number of nodes in the route. This models concentration: a single
      // venue node in a 2-node route has concentration 0.5.
      const baseConcentration = 1 / nodes.length;
      riskConcentration[key] = Math.max(
        riskConcentration[key] ?? 0,
        baseConcentration,
      );
    }
  }
}
