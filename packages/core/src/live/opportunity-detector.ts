/**
 * OpportunityDetector: builds a MarketGraph from multi-venue market data
 * and discovers arbitrage routes using the RouteEngine.
 *
 * This replaces synthetic opportunity generation with real price comparison
 * across venues. It:
 *   1. Ingests MarketDataSnapshot from each venue connector
 *   2. Builds/updates a MarketGraph with ASSET and VENUE nodes
 *   3. Creates ORDER_BOOK edges with price/fee/liquidity weights
 *   4. Uses RouteEngine to discover profitable cycles
 *   5. Converts routes to OpportunityCandidates scored on the canonical
 *      expectedNetProfitUsd with the canonical cost breakdown (ADR-0014)
 *
 * CONTEXT.md compliance:
 *   - §2: Exploits liquidity fragmentation (price differences between venues)
 *   - §12: Uses Graph Engineering to find profitable paths
 *   - §17: Separates signal (detection) from decision (risk) and execution
 */

import type {
  MarketDataSnapshot,
  OpportunityCandidate,
  OrderIntent,
  OrderSide,
  RiskReasonCode,
  Route,
} from "@agenttrading/contracts";
import { CANDIDATE_STATUS, DEFAULT_ROUTE_ENGINE_CONFIG } from "@agenttrading/contracts";
import { computeRouteCost, MarketGraph } from "@agenttrading/graph";
import { RouteEngine } from "./route-engine.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface OpportunityDetectorConfig {
  /** Minimum expected net profit (USD) to consider a route viable. */
  minNetProfitUsd: number;
  /** Trading fee rate in basis points (default: 10 = 0.1%). */
  feeBps: number;
  /** Maximum route length (hops) to consider. */
  maxRouteLength: number;
}

export const DEFAULT_OPPORTUNITY_DETECTOR_CONFIG: OpportunityDetectorConfig = {
  minNetProfitUsd: 0.5,
  feeBps: 10,
  maxRouteLength: 4,
};

export interface DetectedOpportunity {
  candidate: OpportunityCandidate;
  intent: OrderIntent;
}

// ── OpportunityDetector ──────────────────────────────────────────────

export class OpportunityDetector {
  private readonly graph: MarketGraph;
  private readonly routeEngine: RouteEngine;
  private readonly config: OpportunityDetectorConfig;
  private readonly now: () => number;

  constructor(config: Partial<OpportunityDetectorConfig> = {}, now?: () => number) {
    this.config = { ...DEFAULT_OPPORTUNITY_DETECTOR_CONFIG, ...config };
    this.now = now ?? (() => Date.now());
    this.graph = new MarketGraph();
    this.routeEngine = new RouteEngine({
      ...DEFAULT_ROUTE_ENGINE_CONFIG,
      maxRouteLength: this.config.maxRouteLength,
    });
  }

  /**
   * Ingest a market data snapshot from a venue connector.
   * Creates ASSET and VENUE nodes and ORDER_BOOK edges with price weights.
   */
  ingestMarketData(snapshot: MarketDataSnapshot): void {
    if (snapshot.mid === null || snapshot.mid <= 0) return;

    const venueId = `venue:${snapshot.venue}`;
    const assetId = this.normalizeAssetId(snapshot.symbol, snapshot.venue);

    // Create venue node.
    this.graph.addNode({
      id: venueId,
      type: "VENUE",
      meta: { chain: snapshot.chain ?? "unknown" },
    });

    // Create asset node.
    this.graph.addNode({
      id: assetId,
      type: "ASSET",
      meta: { symbol: snapshot.symbol },
    });

    // Create ORDER_BOOK edge: venue → asset (buy at ask)
    const ask = snapshot.ask ?? snapshot.mid;
    const bid = snapshot.bid ?? snapshot.mid;
    const spread = ask - bid;
    const feeUsd = ask * (this.config.feeBps / 10_000);

    this.graph.upsertEdge(
      venueId,
      assetId,
      "ORDER_BOOK",
      {
        price: ask,
        fee: feeUsd,
        expectedSlippage: spread / 2,
        liquidityUsd: snapshot.depth,
        confidence: this.computeDataConfidence(snapshot),
        riskScore: 0.1,
        failureProbability: snapshot.rpcHealth === "healthy" ? 0.01 : 0.5,
      },
      snapshot.source,
      snapshot.rpcHealth !== "unavailable",
    );

    // Create reverse edge: asset → venue (sell at bid)
    const reverseFeeUsd = bid * (this.config.feeBps / 10_000);
    this.graph.upsertEdge(
      assetId,
      venueId,
      "ORDER_BOOK",
      {
        price: bid,
        fee: reverseFeeUsd,
        expectedSlippage: spread / 2,
        liquidityUsd: snapshot.depth,
        confidence: this.computeDataConfidence(snapshot),
        riskScore: 0.1,
        failureProbability: snapshot.rpcHealth === "healthy" ? 0.01 : 0.5,
      },
      snapshot.source,
      snapshot.rpcHealth !== "unavailable",
    );
  }

  /**
   * Detect opportunities by discovering routes in the current graph state.
   * Returns OpportunityCandidates with full cost breakdown.
   */
  detectOpportunities(): DetectedOpportunity[] {
    const snapshot = this.graph.snapshot();
    if (snapshot.nodes.length < 2) return [];

    const discovery = this.routeEngine.discover(snapshot, this.now());
    const opportunities: DetectedOpportunity[] = [];

    for (const route of discovery.liveRoutes) {
      const candidate = this.routeToCandidate(route, snapshot);
      if (candidate === null) continue;
      if (candidate.expectedNetProfitUsd < this.config.minNetProfitUsd) continue;

      const intent = this.candidateToOrderIntent(candidate);
      opportunities.push({ candidate, intent });
    }

    return opportunities;
  }

  /**
   * Get the current graph snapshot for inspection or route discovery.
   */
  getGraphSnapshot(): ReturnType<MarketGraph["snapshot"]> {
    return this.graph.snapshot();
  }

  /**
   * Get the underlying MarketGraph (for advanced usage).
   */
  get graphInstance(): MarketGraph {
    return this.graph;
  }

  // ── Private helpers ───────────────────────────────────────────────

  /**
   * Normalize a symbol+venue into a stable asset node id.
   * Converts "BTC/USDT" or "BTCUSDT" to "asset:BTC/USDT:bybit".
   */
  private normalizeAssetId(symbol: string, venue: string): string {
    const normalized = symbol.includes("/") ? symbol : this.insertSlash(symbol);
    return `asset:${normalized}:${venue}`;
  }

  /**
   * Insert a slash into a symbol like "BTCUSDT" → "BTC/USDT".
   * Uses common quote assets to find the split point.
   */
  private insertSlash(symbol: string): string {
    const quotes = ["USDT", "USDC", "BTC", "ETH", "DAI", "BUSD", "TUSD"];
    for (const quote of quotes) {
      if (symbol.endsWith(quote) && symbol.length > quote.length) {
        return `${symbol.slice(0, -quote.length)}/${quote}`;
      }
    }
    return symbol;
  }

  /**
   * Compute data confidence from snapshot freshness and source.
   */
  private computeDataConfidence(snapshot: MarketDataSnapshot): number {
    const age = this.now() - snapshot.timestampMs;
    if (age > 30_000) return 0.3;
    if (age > 10_000) return 0.6;
    if (age > 5_000) return 0.8;
    return 1.0;
  }

  /**
   * Convert a discovered Route into an OpportunityCandidate with the canonical
   * cost breakdown.
   *
   * The candidate is scored on `route.expectedNetProfitUsd` — the same figure
   * the route engine gates (MIN_EDGE) and the risk gate evaluates. The cost
   * breakdown and its single sum come from `computeRouteCost` in
   * `@agenttrading/graph`, the single source of truth for the RISK.md net
   * profit formula (ADR-0014). This detector owns no cost math.
   */
  private routeToCandidate(
    route: Route,
    snapshot: ReturnType<MarketGraph["snapshot"]>,
  ): OpportunityCandidate | null {
    if (route.nodes.length < 2) return null;

    const routeCost = computeRouteCost(snapshot, route.nodes);
    const netProfit = route.expectedNetProfitUsd;

    const invalidationReasons: RiskReasonCode[] = [];
    if (netProfit < this.config.minNetProfitUsd) {
      invalidationReasons.push("MIN_EDGE");
    }

    return {
      id: `opp:${route.routeId}:${this.now()}`,
      snapshotId: snapshot.snapshotId,
      route: route.nodes,
      grossSpreadUsd: netProfit + routeCost.totalCostUsd,
      costs: routeCost.costs,
      expectedNetProfitUsd: netProfit,
      createdAtMs: this.now(),
      status: invalidationReasons.length > 0 ? "INVALID" : CANDIDATE_STATUS,
      invalidationReasons: invalidationReasons.length > 0 ? invalidationReasons : undefined,
      maxCapitalUsd: routeCost.bottleneckLiquidityUsd,
      confidence: route.confidence,
      riskConcentration: route.riskConcentration,
    };
  }

  /**
   * Convert an OpportunityCandidate into an OrderIntent.
   * The intent still requires RiskEngine approval before execution.
   */
  private candidateToOrderIntent(candidate: OpportunityCandidate): OrderIntent {
    const side: OrderSide = this.determineOrderSide(candidate);
    const { symbol, venue } = this.extractVenueAndSymbol(candidate);

    return {
      idempotencyKey: `intent:${candidate.id}:${this.now()}`,
      opportunityId: candidate.id,
      venue,
      symbol,
      side,
      quantity: 0.001,
      price: this.extractEntryPrice(candidate),
      quoteCurrency: "USDT",
      createdAtMs: this.now(),
      expiresAtMs: this.now() + 60_000,
      limits: {
        maxSlippageBps: this.config.feeBps,
      },
    };
  }

  /**
   * Determine order side from route direction.
   */
  private determineOrderSide(candidate: OpportunityCandidate): OrderSide {
    if (candidate.route.length < 2) return "BUY";
    const firstNode = candidate.route[0];
    return firstNode.startsWith("venue:") ? "BUY" : "SELL";
  }

  /**
   * Extract venue and symbol from the candidate route.
   */
  private extractVenueAndSymbol(candidate: OpportunityCandidate): { venue: string; symbol: string } {
    for (const nodeId of candidate.route) {
      if (nodeId.startsWith("venue:")) {
        const venue = nodeId.replace("venue:", "");
        return { venue, symbol: "BTCUSDT" };
      }
    }
    return { venue: "bybit", symbol: "BTCUSDT" };
  }

  /**
   * Extract entry price from the first edge in the route.
   */
  private extractEntryPrice(candidate: OpportunityCandidate): number {
    // Find the first edge in the route by looking up consecutive node pairs
    for (let i = 0; i < candidate.route.length - 1; i++) {
      const fromId = candidate.route[i];
      const toId = candidate.route[i + 1];
      const edges = this.graph.getEdgesFrom(fromId);
      const edge = edges.find((e) => e.to === toId);
      if (edge?.weights.price !== undefined) {
        return edge.weights.price;
      }
    }
    return 0;
  }
}
