import {
  type MarketDataSnapshot,
  type PoolStateUpdatePayload,
  type GasUpdatePayload,
  type FundingUpdatePayload,
  type OrderBookSnapshotPayload,
} from "@agenttrading/contracts";
import type { MarketGraph } from "./market-graph.ts";
import type { EdgeWeights } from "@agenttrading/contracts";

/**
 * Event Processor for the MarketGraph.
 *
 * Decouples incremental event handling from the core graph state management,
 * addressing the Divergent Change smell.
 */
export class GraphEventProcessor {
  constructor(private graph: MarketGraph) {}

  /**
   * Process a MARKET_TICK / MarketDataSnapshot.
   */
  applyTick(tick: MarketDataSnapshot): string[] {
    const touched: string[] = [];
    const { assetId, venueId, chainId } = this.graph.ensureAssetAndVenueNodes(
      tick.symbol,
      tick.venue,
      tick.chain,
    );
    if (chainId) touched.push(chainId);
    touched.push(assetId, venueId);

    const mid = tick.mid ?? ((tick.bid ?? 0) + (tick.ask ?? 0)) / 2;
    const weights: EdgeWeights = {};
    if (mid > 0) weights.price = mid;
    if (tick.depth > 0) weights.liquidityUsd = tick.depth;
    if (tick.latencyMs > 0) weights.latencyMs = tick.latencyMs;

    const edgeId = this.graph.upsertEdge(
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
   * Process an ORDERBOOK_SNAPSHOT event.
   */
  applyOrderBook(ob: OrderBookSnapshotPayload): string[] {
    const touched: string[] = [];
    const { assetId, venueId } = this.graph.ensureAssetAndVenueNodes(ob.symbol, ob.venue);
    touched.push(assetId, venueId);

    const bestBid = ob.bids[0]?.price ?? 0;
    const bestAsk = ob.asks[0]?.price ?? 0;
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
    const bidDepth = ob.bids.reduce((sum, l) => sum + l.size * l.price, 0);
    const askDepth = ob.asks.reduce((sum, l) => sum + l.size * l.price, 0);

    const weights: EdgeWeights = {};
    if (mid > 0) weights.price = mid;
    weights.liquidityUsd = bidDepth + askDepth;

    const edgeId = this.graph.upsertEdge(
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
   * Process a POOL_STATE_UPDATE event.
   */
  applyPoolState(pool: PoolStateUpdatePayload): string[] {
    const touched: string[] = [];
    const poolNodeId = `pool:${pool.venue}:${pool.poolAddress}`;
    this.graph.upsertNode({ id: poolNodeId, type: "POOL", meta: { address: pool.poolAddress } });
    const { assetId, venueId } = this.graph.ensureAssetAndVenueNodes(pool.symbol, pool.venue);
    touched.push(poolNodeId, assetId, venueId);

    const weights: EdgeWeights = {};
    if (pool.price !== undefined) weights.price = pool.price;
    if (pool.liquidityUsd !== undefined) weights.liquidityUsd = pool.liquidityUsd;

    const edgeId = this.graph.upsertEdge(
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
   * Process a GAS_UPDATE event.
   */
  applyGasUpdate(gas: GasUpdatePayload): string[] {
    const touched: string[] = [];
    for (const edge of this.graph.getEdges()) {
      if (edge.source === gas.venue || edge.source.startsWith(`${gas.venue}:`)) {
        if (edge.type === "ORDER_BOOK" || edge.type === "SWAP") {
          this.graph.upsertEdge(
            edge.from,
            edge.to,
            edge.type,
            { ...edge.weights, gasCost: gas.gasPriceGwei },
            edge.source,
            edge.tradable,
          );
          touched.push(edge.id);
        }
      }
    }
    return touched;
  }

  /**
   * Process a FUNDING_UPDATE event.
   */
  applyFundingUpdate(funding: FundingUpdatePayload): string[] {
    const touched: string[] = [];
    for (const edge of this.graph.getEdges()) {
      if (
        edge.source === funding.venue &&
        edge.type === "ORDER_BOOK"
      ) {
        this.graph.upsertEdge(
          edge.from,
          edge.to,
          edge.type,
          { ...edge.weights, fundingCost: funding.fundingRate },
          edge.source,
          edge.tradable,
        );
        touched.push(edge.id);
      }
    }
    return touched;
  }

  /**
   * Apply a batch of normalized events in sequence.
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
}
