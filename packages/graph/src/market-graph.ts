import {
  isMarketNode,
  isMarketEdge,
  type MarketEdge,
  type MarketNode,
  type MarketGraphSnapshot,
  type MarketNodeType,
  type MarketEdgeType,
  type EdgeWeights,
  type MarketDataSnapshot,
  type PoolStateUpdatePayload,
  type GasUpdatePayload,
  type FundingUpdatePayload,
  type OrderBookSnapshotPayload,
} from "@agenttrading/contracts";

/**
 * MarketGraph engine (Spec Alpha, user stories 11–18).
 *
 * Directed, weighted graph of typed nodes (ASSET, VENUE, CHAIN, POOL,
 * ACCOUNT, STRATEGY) and edges (ORDER_BOOK, SWAP, BRIDGE, TRANSFER,
 * FUNDING, CORRELATION).  Supports:
 *
 * - **Incremental updates** from normalized events (ticks, order books,
 *   pool state, gas, funding).
 * - **Versioned snapshots** tied to every decision.
 * - **Route filtering** that discards non-executable paths (too illiquid,
 *   too risky, too many hops, or containing dead edges).
 *
 * The engine is a pure, dependency-free state container — it does not own
 * an event bus; callers push events through `applyTick()`,
 * `applyOrderBook()`, etc.
 */
export class MarketGraph {
  private nodes = new Map<string, MarketNode>();
  private edges = new Map<string, MarketEdge>();
  private _version = 0;
  private _snapshotCounter = 0;

  // ── Node operations ──────────────────────────────────────────────

  /** Insert a node if it does not exist; no-op when the id already exists. */
  addNode(node: MarketNode): void {
    if (this.nodes.has(node.id)) return;
    this.nodes.set(node.id, node);
    this._version++;
  }

  /**
   * Insert-or-update a node. When the node already exists, its `meta`
   * fields are merged (shallow) and the version is bumped.
   */
  upsertNode(node: MarketNode): void {
    const existing = this.nodes.get(node.id);
    if (existing) {
      if (node.meta && Object.keys(node.meta).length > 0) {
        this.nodes.set(node.id, {
          ...existing,
          meta: { ...existing.meta, ...node.meta },
        });
        this._version++;
      }
      return;
    }
    this.nodes.set(node.id, node);
    this._version++;
  }

  removeNode(id: string): boolean {
    const existed = this.nodes.delete(id);
    if (!existed) return false;

    // Remove all edges touching this node.
    for (const [edgeId, edge] of this.edges) {
      if (edge.from === id || edge.to === id) {
        this.edges.delete(edgeId);
      }
    }
    this._version++;
    return true;
  }

  getNode(id: string): MarketNode | undefined {
    return this.nodes.get(id);
  }

  getNodes(): MarketNode[] {
    return [...this.nodes.values()];
  }

  getNodesByType(type: MarketNodeType): MarketNode[] {
    return this.getNodes().filter((n) => n.type === type);
  }

  // ── Edge operations ──────────────────────────────────────────────

  /**
   * Upsert an edge identified by `from`→`to`+`type`. If an edge with the
   * same key already exists its weights are replaced; otherwise a new edge
   * is inserted. Returns the (possibly new) edge id.
   */
  upsertEdge(
    from: string,
    to: string,
    type: MarketEdgeType,
    weights: EdgeWeights,
    source: string,
    tradable = true,
  ): string {
    const edgeId = `${from}→${to}:${type}`;
    const existing = this.edges.get(edgeId);
    if (existing) {
      this.edges.set(edgeId, {
        ...existing,
        weights,
        source,
        tradable,
      });
      this._version++;
      return edgeId;
    }
    const edge: MarketEdge = {
      id: edgeId,
      from,
      to,
      type,
      weights,
      tradable,
      source,
    };
    this.edges.set(edgeId, edge);
    this._version++;
    return edgeId;
  }

  removeEdge(id: string): boolean {
    const existed = this.edges.delete(id);
    if (existed) this._version++;
    return existed;
  }

  getEdge(id: string): MarketEdge | undefined {
    return this.edges.get(id);
  }

  getEdges(): MarketEdge[] {
    return [...this.edges.values()];
  }

  getEdgesFrom(nodeId: string): MarketEdge[] {
    return this.getEdges().filter((e) => e.from === nodeId && e.tradable);
  }

  getEdgesTo(nodeId: string): MarketEdge[] {
    return this.getEdges().filter((e) => e.to === nodeId && e.tradable);
  }

  // ── Snapshot ─────────────────────────────────────────────────────

  /** Current graph version (bumped on every structural change). */
  get version(): number {
    return this._version;
  }

  /** Total snapshots created so far. */
  get snapshotCount(): number {
    return this._snapshotCounter;
  }

  /**
   * Capture a versioned snapshot. Every decision in the system can be
   * tied to the graph state that produced it.
   */
  snapshot(): MarketGraphSnapshot {
    this._snapshotCounter++;
    return {
      version: this._version,
      snapshotId: `snap:${this._snapshotCounter}:${this._version}`,
      createdAtMs: Date.now(),
      nodes: this.getNodes(),
      edges: this.getEdges(),
    };
  }

  // ── Incremental updates from normalized events ───────────────────

  /**
   * Process a MARKET_TICK / MarketDataSnapshot. Creates or updates:
   * - An ASSET node for `tick.symbol`
   * - A VENUE node for `tick.venue`
   * - An ORDER_BOOK edge between them carrying bid/ask/mid and depth
   *
   * Returns the ids of all touched nodes/edges.
   */
  applyTick(tick: MarketDataSnapshot): string[] {
    const touched: string[] = [];
    const assetId = `asset:${tick.symbol}`;
    const venueId = `venue:${tick.venue}`;

    this.upsertNode({ id: assetId, type: "ASSET" });
    this.upsertNode({ id: venueId, type: "VENUE" });
    if (tick.chain) {
      const chainId = `chain:${tick.chain}`;
      this.upsertNode({ id: chainId, type: "CHAIN" });
      touched.push(chainId);
    }
    touched.push(assetId, venueId);

    const mid = tick.mid ?? ((tick.bid ?? 0) + (tick.ask ?? 0)) / 2;
    const weights: EdgeWeights = {};
    if (mid > 0) weights.price = mid;
    if (tick.depth > 0) weights.liquidityUsd = tick.depth;
    if (tick.latencyMs > 0) weights.latencyMs = tick.latencyMs;

    const edgeId = this.upsertEdge(
      assetId,
      venueId,
      "ORDER_BOOK",
      weights,
      tick.source,
    );
    touched.push(edgeId);
    return touched;
  }

  /**
   * Process an ORDERBOOK_SNAPSHOT event. Creates or updates the
   * ORDER_BOOK edge between asset and venue with bid/ask depth.
   */
  applyOrderBook(ob: OrderBookSnapshotPayload): string[] {
    const touched: string[] = [];
    const assetId = `asset:${ob.symbol}`;
    const venueId = `venue:${ob.venue}`;

    this.upsertNode({ id: assetId, type: "ASSET" });
    this.upsertNode({ id: venueId, type: "VENUE" });
    touched.push(assetId, venueId);

    const bestBid = ob.bids[0]?.price ?? 0;
    const bestAsk = ob.asks[0]?.price ?? 0;
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
    const bidDepth = ob.bids.reduce((sum, l) => sum + l.size * l.price, 0);
    const askDepth = ob.asks.reduce((sum, l) => sum + l.size * l.price, 0);

    const weights: EdgeWeights = {};
    if (mid > 0) weights.price = mid;
    weights.liquidityUsd = bidDepth + askDepth;

    const edgeId = this.upsertEdge(
      assetId,
      venueId,
      "ORDER_BOOK",
      weights,
      ob.venue,
    );
    touched.push(edgeId);
    return touched;
  }

  /**
   * Process a POOL_STATE_UPDATE event. Creates or updates a POOL node
   * and a SWAP edge from pool to asset carrying the derived price and
   * pool liquidity.
   */
  applyPoolState(pool: PoolStateUpdatePayload): string[] {
    const touched: string[] = [];
    const poolNodeId = `pool:${pool.venue}:${pool.poolAddress}`;
    const assetId = `asset:${pool.symbol}`;
    const venueId = `venue:${pool.venue}`;

    this.upsertNode({ id: poolNodeId, type: "POOL", meta: { address: pool.poolAddress } });
    this.upsertNode({ id: assetId, type: "ASSET" });
    this.upsertNode({ id: venueId, type: "VENUE" });
    touched.push(poolNodeId, assetId, venueId);

    const weights: EdgeWeights = {};
    if (pool.price !== undefined) weights.price = pool.price;
    if (pool.liquidityUsd !== undefined) weights.liquidityUsd = pool.liquidityUsd;

    const edgeId = this.upsertEdge(
      poolNodeId,
      assetId,
      "SWAP",
      weights,
      pool.venue,
    );
    touched.push(edgeId);
    return touched;
  }

  /**
   * Process a GAS_UPDATE event. Updates all ORDER_BOOK and SWAP edges
   * from the matching venue with the new gas cost estimate.
   */
  applyGasUpdate(gas: GasUpdatePayload): string[] {
    const touched: string[] = [];
    for (const edge of this.edges.values()) {
      if (edge.source === gas.venue || edge.source.startsWith(`${gas.venue}:`)) {
        if (edge.type === "ORDER_BOOK" || edge.type === "SWAP") {
          this.edges.set(edge.id, {
            ...edge,
            weights: { ...edge.weights, gasCost: gas.gasPriceGwei },
          });
          touched.push(edge.id);
        }
      }
    }
    if (touched.length > 0) this._version++;
    return touched;
  }

  /**
   * Process a FUNDING_UPDATE event. Updates all ORDER_BOOK edges from
   * the matching venue with the funding rate.
   */
  applyFundingUpdate(funding: FundingUpdatePayload): string[] {
    const touched: string[] = [];
    for (const edge of this.edges.values()) {
      if (
        edge.source === funding.venue &&
        edge.type === "ORDER_BOOK"
      ) {
        this.edges.set(edge.id, {
          ...edge,
          weights: { ...edge.weights, fundingCost: funding.fundingRate },
        });
        touched.push(edge.id);
      }
    }
    if (touched.length > 0) this._version++;
    return touched;
  }

  /**
   * Apply a batch of normalized events in sequence. Each event type is
   * dispatched to the appropriate `apply*` method. Returns the total
   * count of touched elements.
   */
  applyEvents(
    events: ReadonlyArray<
      | { type: "MARKET_TICK"; payload: MarketDataSnapshot }
      | { type: "ORDERBOOK_SNAPSHOT"; payload: OrderBookSnapshotPayload }
      | { type: "POOL_STATE_UPDATE"; payload: PoolStateUpdatePayload }
      | { type: "GAS_UPDATE"; payload: GasUpdatePayload }
      | { type: "FUNDING_UPDATE"; payload: FundingUpdatePayload }
    >,
  ): number {
    let total = 0;
    for (const event of events) {
      switch (event.type) {
        case "MARKET_TICK":
          total += this.applyTick(event.payload).length;
          break;
        case "ORDERBOOK_SNAPSHOT":
          total += this.applyOrderBook(event.payload).length;
          break;
        case "POOL_STATE_UPDATE":
          total += this.applyPoolState(event.payload).length;
          break;
        case "GAS_UPDATE":
          total += this.applyGasUpdate(event.payload).length;
          break;
        case "FUNDING_UPDATE":
          total += this.applyFundingUpdate(event.payload).length;
          break;
      }
    }
    return total;
  }

  // ── Route filtering ──────────────────────────────────────────────

  /**
   * Discard non-executable routes. A route is discarded when:
   * - It contains a non-tradable edge.
   * - Total path liquidity falls below `minLiquidityUsd`.
   * - Path length (number of hops) exceeds `maxHops`.
   * - Any edge in the route has a failure probability above
   *   `maxFailureProbability`.
   * - The route contains a cycle (repeated node id).
   */
  filterExecutableRoutes(
    routes: readonly string[][],
    options: {
      minLiquidityUsd?: number;
      maxHops?: number;
      maxFailureProbability?: number;
    } = {},
  ): string[][] {
    const {
      minLiquidityUsd = 0,
      maxHops = 10,
      maxFailureProbability = 1.0,
    } = options;

    return routes.filter((route) => {
      // Discard cycles.
      if (new Set(route).size !== route.length) return false;
      // Discard overly long routes.
      if (route.length - 1 > maxHops) return false;

      let minLiquidity = Infinity;
      for (let i = 0; i < route.length - 1; i++) {
        const fromId = route[i];
        const toId = route[i + 1];
        const edge = this.findEdgeBetween(fromId, toId);
        if (!edge || !edge.tradable) return false;
        if ((edge.weights.failureProbability ?? 0) > maxFailureProbability) {
          return false;
        }
        const liq = edge.weights.liquidityUsd ?? Infinity;
        if (liq < minLiquidity) minLiquidity = liq;
      }
      return minLiquidity >= minLiquidityUsd;
    });
  }

  /**
   * Find the first tradable edge between two nodes (regardless of edge
   * type). Returns `undefined` when no such edge exists.
   */
  private findEdgeBetween(fromId: string, toId: string): MarketEdge | undefined {
    for (const edge of this.edges.values()) {
      if (edge.from === fromId && edge.to === toId && edge.tradable) {
        return edge;
      }
    }
    return undefined;
  }

  /**
   * Restore a graph from a previously-captured snapshot. Replaces the
   * current state entirely.
   */
  restoreFromSnapshot(snapshot: MarketGraphSnapshot): void {
    this.nodes.clear();
    this.edges.clear();
    for (const node of snapshot.nodes) {
      this.nodes.set(node.id, node);
    }
    for (const edge of snapshot.edges) {
      this.edges.set(edge.id, edge);
    }
    this._version = snapshot.version;
  }
}
