import {
  isEventEnvelope,
  parseEventEnvelope,
  type EventEnvelope,
  type MarketEdge,
  type MarketGraphSnapshot,
  type MarketNode,
  parseMarketTickPayload,
  parseOrderBookSnapshotPayload,
  parsePoolStateUpdatePayload,
} from "@agenttrading/contracts";
import { EventStore } from "./store.ts";

/**
 * Deterministic replay (issue #17 AC3, AC4; user stories 10, 19). A recorded
 * session replays to an identical event stream and order, and the replayed
 * stream reconstructs the same graph state that folding the original stream
 * produced.
 */

/** Replays every persisted event in append (sequence) order. */
export function replayAll(store: EventStore): EventEnvelope[] {
  return store.all().map((event) => parseEventEnvelope(event));
}

/** Replays events appended after the given sequence, in sequence order. */
export function replaySince(store: EventStore, sequence: number): EventEnvelope[] {
  return store.since(sequence).map((event) => parseEventEnvelope(event));
}

/** Compares two event streams including payload — identical event and order. */
export function sameEventStream(
  left: readonly EventEnvelope[],
  right: readonly EventEnvelope[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (event, index) =>
      event.eventId === right[index].eventId &&
      event.sequence === right[index].sequence &&
      event.type === right[index].type &&
      event.kind === right[index].kind &&
      event.timestampMs === right[index].timestampMs &&
      event.source === right[index].source &&
      JSON.stringify(event.payload) === JSON.stringify(right[index].payload),
  );
}

/**
 * Folds a recorded session's market events into a versioned graph snapshot.
 * Deterministic: identical input events always produce the identical snapshot
 * (same version, snapshotId, nodes, and edges), so replay and live folding
 * agree bit for bit.
 *
 * Only MARKET_TICK, ORDERBOOK_SNAPSHOT/DELTA, and POOL_STATE_UPDATE
 * contribute graph edges/nodes. All other event types (GAS_UPDATE,
 * FUNDING_UPDATE, DATA_QUALITY_UPDATE, GRAPH_UPDATED, AUDIT_EVENT) are
 * intentionally skipped — they do not carry graph-topology information.
 */
export function foldGraphState(
  events: readonly EventEnvelope[],
): MarketGraphSnapshot {
  const nodes = new Map<string, MarketNode>();
  const edges = new Map<string, MarketEdge>();
  let foldedCount = 0;

  for (const event of events) {
    if (!isEventEnvelope(event)) {
      continue;
    }
    switch (event.type) {
      case "MARKET_TICK": {
        foldedCount++;
        const tick = parseMarketTickPayload(event.payload);
        upsertNode(nodes, { id: `asset:${tick.symbol}`, type: "ASSET" });
        upsertNode(nodes, { id: `venue:${tick.venue}`, type: "VENUE" });
        upsertEdge(edges, {
          id: `book:${tick.venue}:${tick.symbol}`,
          from: `venue:${tick.venue}`,
          to: `asset:${tick.symbol}`,
          type: "ORDER_BOOK",
          weights: {
            price: tick.mid ?? undefined,
            latencyMs: tick.latencyMs,
            liquidityUsd: tick.depth,
          },
          tradable: true,
          source: event.source,
        });
        break;
      }
      case "ORDERBOOK_SNAPSHOT":
      case "ORDERBOOK_DELTA": {
        foldedCount++;
        const book = parseOrderBookSnapshotPayload(event.payload);
        const bestBid = book.bids[0]?.price;
        const bestAsk = book.asks[0]?.price;
        const mid =
          bestBid !== undefined && bestAsk !== undefined
            ? (bestBid + bestAsk) / 2
            : undefined;
        upsertNode(nodes, { id: `asset:${book.symbol}`, type: "ASSET" });
        upsertNode(nodes, { id: `venue:${book.venue}`, type: "VENUE" });
        upsertEdge(edges, {
          id: `book:${book.venue}:${book.symbol}`,
          from: `venue:${book.venue}`,
          to: `asset:${book.symbol}`,
          type: "ORDER_BOOK",
          weights: { price: mid, liquidityUsd: totalLevelValueUsd(book.bids, book.asks) },
          tradable: true,
          source: event.source,
        });
        break;
      }
      case "POOL_STATE_UPDATE": {
        foldedCount++;
        const pool = parsePoolStateUpdatePayload(event.payload);
        upsertNode(nodes, { id: `asset:${pool.symbol}`, type: "ASSET" });
        upsertNode(nodes, { id: `venue:${pool.venue}`, type: "VENUE" });
        upsertNode(nodes, {
          id: `pool:${pool.poolAddress}`,
          type: "POOL",
          meta: { venue: pool.venue },
        });
        upsertEdge(edges, {
          id: `swap:${pool.poolAddress}:${pool.symbol}`,
          from: `pool:${pool.poolAddress}`,
          to: `asset:${pool.symbol}`,
          type: "SWAP",
          weights: { price: pool.price, liquidityUsd: pool.liquidityUsd },
          tradable: true,
          source: event.source,
        });
        break;
      }
      // GAS_UPDATE, FUNDING_UPDATE, DATA_QUALITY_UPDATE, GRAPH_UPDATED,
      // and AUDIT_EVENT do not carry graph-topology information and are
      // intentionally excluded from the fold.
      default:
        break;
    }
  }

  const sortedNodes = [...nodes.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const sortedEdges = [...edges.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  return {
    version: foldedCount,
    snapshotId: snapshotIdFor(sortedNodes, sortedEdges),
    createdAtMs:
      events.filter(isEventEnvelope).at(-1)?.timestampMs ?? 0,
    nodes: sortedNodes,
    edges: sortedEdges,
  };
}

function upsertNode(nodes: Map<string, MarketNode>, node: MarketNode): void {
  nodes.set(node.id, node);
}

function upsertEdge(edges: Map<string, MarketEdge>, edge: MarketEdge): void {
  edges.set(edge.id, edge);
}

function totalLevelValueUsd(
  bids: readonly { price: number; size: number }[],
  asks: readonly { price: number; size: number }[],
): number {
  const bidValue = bids.reduce((sum, level) => sum + level.price * level.size, 0);
  const askValue = asks.reduce((sum, level) => sum + level.price * level.size, 0);
  return bidValue + askValue;
}

/** Deterministic content hash so identical states yield identical snapshot ids. */
function snapshotIdFor(nodes: readonly MarketNode[], edges: readonly MarketEdge[]): string {
  const fingerprint = JSON.stringify({ nodes, edges });
  let hash = 0x811c9dc5;
  for (let i = 0; i < fingerprint.length; i++) {
    hash ^= fingerprint.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `snap-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
