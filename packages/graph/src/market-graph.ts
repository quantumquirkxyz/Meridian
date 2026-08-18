import {
  type MarketEdge,
  type MarketNode,
  type MarketGraphSnapshot,
  type MarketNodeType,
  type MarketEdgeType,
  type EdgeWeights,
} from "@agenttrading/contracts";

/**
 * MarketGraph engine (Spec Alpha, user stories 11–18).
 *
 * Directed, weighted graph of typed nodes (ASSET, VENUE, CHAIN, POOL,
 * ACCOUNT, STRATEGY) and edges (ORDER_BOOK, SWAP, BRIDGE, TRANSFER,
 * FUNDING, CORRELATION).  Supports:
 *
 * - **Incremental updates** from normalized events (ticks, order books,
 *   pool state, gas, funding) via the `GraphEventProcessor`.
 * - **Versioned snapshots** tied to every decision.
 * - **Route filtering** that discards non-executable paths (too illiquid,
 *   too risky, too many hops, or containing dead edges).
 *
 * The engine is a pure, dependency-free state container — it does not own
 * an event bus. Event handling is delegated to `GraphEventProcessor` to
 * maintain a clean separation of concerns.
 *
 * NOTE: While `ACCOUNT`, `STRATEGY`, `TRANSFER`, and `CORRELATION` are
 * valid types in the contracts, their event-processing logic is deferred
 * until their respective event payloads are defined in `@agenttrading/contracts`.
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
