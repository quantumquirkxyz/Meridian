import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus } from "../src/bus.ts";
import {
  foldGraphState,
  replayAll,
  replaySince,
  sameEventStream,
} from "../src/replay.ts";
import { EventStore, type PublishEvent } from "../src/store.ts";
import { makeEventId } from "@agenttrading/contracts";

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "agenttrading-events-"));
  return join(dir, "events.db");
}

function tickEvent(
  eventId: string,
  symbol: string,
  bid: number,
  ask: number,
  timestampMs: number,
): PublishEvent {
  return {
    eventId,
    type: "MARKET_TICK",
    kind: "normalized",
    timestampMs,
    source: "bybit-ws-linear",
    payload: {
      venue: "bybit",
      symbol,
      timestampMs,
      bid,
      ask,
      mid: (bid + ask) / 2,
      depth: 1_000_000,
      latencyMs: 12,
      source: "bybit-ws-linear",
    },
  };
}

function rawTickEvent(
  eventId: string,
  symbol: string,
  timestampMs: number,
): PublishEvent {
  return {
    eventId,
    type: "MARKET_TICK",
    kind: "raw",
    timestampMs,
    source: "bybit-ws",
    payload: { symbol, rawAsk: "30001.0", rawBid: "30000.0" },
  };
}

describe("event bus + persistence + replay (issue #17)", () => {
  test("AC1: events are published with idempotency keys and deduplicated", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const delivered: string[] = [];
    bus.subscribe("MARKET_TICK", (event) => delivered.push(event.eventId));

    const event = tickEvent("k1", "BTC/USDT", 30_000, 30_001, 1_000);
    const first = bus.publish(event);
    const duplicate = bus.publish(event);

    expect(first.deduplicated).toBe(false);
    expect(duplicate.deduplicated).toBe(true);
    expect(duplicate.event.sequence).toBe(first.event.sequence);
    expect(store.count()).toBe(1);
    expect(delivered).toEqual(["k1"]);
  });

  test("AC2: raw and normalized events both persist to SQLite", () => {
    const path = tempDb();
    const store = new EventStore(path);
    const bus = new EventBus(store);

    bus.publish(rawTickEvent("raw-1", "BTCUSDT", 1_000));
    bus.publish(tickEvent("norm-1", "BTC/USDT", 30_000, 30_001, 1_001));

    expect(store.count()).toBe(2);

    // Reopen from disk and read everything back.
    store.close();
    const reopened = new EventStore(path);
    const all = reopened.all();
    expect(all).toHaveLength(2);
    expect(all.map((event) => event.kind).sort()).toEqual(["normalized", "raw"]);
    expect(all.map((event) => event.sequence)).toEqual([1, 2]);
    reopened.close();
    rmSync(join(path), { force: true });
    rmSync(join(path, ".."), { recursive: true, force: true });
  });

  test("AC3: a recorded market session replays deterministically", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);

    const session: PublishEvent[] = [
      rawTickEvent("r1", "BTCUSDT", 1_000),
      tickEvent("t1", "BTC/USDT", 30_000, 30_001, 1_001),
      tickEvent("t2", "ETH/USDT", 2_000, 2_001, 1_002),
      tickEvent("t3", "SOL/USDT", 100, 101, 1_003),
    ];
    const recorded = session.map((event) => bus.publish(event).event);

    const replay = replayAll(store);
    expect(sameEventStream(recorded, replay)).toBe(true);
    expect(replay.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);

    // Replaying twice yields the identical stream.
    const replayAgain = replayAll(store);
    expect(sameEventStream(replay, replayAgain)).toBe(true);
  });

  test("AC3: replaySince returns the remainder in the same order", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    bus.publish(tickEvent("a", "BTC/USDT", 30_000, 30_001, 1));
    bus.publish(tickEvent("b", "BTC/USDT", 30_001, 30_002, 2));
    bus.publish(tickEvent("c", "BTC/USDT", 30_002, 30_003, 3));

    const tail = replaySince(store, 1);
    expect(tail.map((event) => event.eventId)).toEqual(["b", "c"]);
    expect(tail.map((event) => event.sequence)).toEqual([2, 3]);
  });

  test("AC4: replay reconstructs graph state from market events", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);

    bus.publish(tickEvent("t1", "BTC/USDT", 30_000, 30_001, 1_000));
    bus.publish(tickEvent("t2", "ETH/USDT", 2_000, 2_001, 1_001));
    bus.publish({
      eventId: "p1",
      type: "POOL_STATE_UPDATE",
      kind: "normalized",
      timestampMs: 1_002,
      source: "pancakeswap-v4-rpc",
      payload: {
        venue: "pancakeswap-v4",
        poolAddress: "0xpool",
        symbol: "BNB/USDT",
        timestampMs: 1_002,
        reserve0: 100,
        reserve1: 1_000,
        price: 10,
        liquidityUsd: 50_000,
      },
    });

    const replay = replayAll(store);
    const reconstructed = foldGraphState(replay);

    // Graph state is derived from market events, not a passthrough.
    expect(reconstructed.nodes.map((n) => n.id).sort()).toEqual([
      "asset:BNB/USDT",
      "asset:BTC/USDT",
      "asset:ETH/USDT",
      "pool:0xpool",
      "venue:bybit",
      "venue:pancakeswap-v4",
    ]);
    expect(reconstructed.edges).toHaveLength(3);
    expect(reconstructed.version).toBe(3);

    // Deterministic: reconstruct from same store gives identical result.
    expect(foldGraphState(replayAll(store))).toEqual(reconstructed);
  });

  test("AC4: folding a session is deterministic and matches replay", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const session: PublishEvent[] = [
      tickEvent("t1", "BTC/USDT", 30_000, 30_001, 1_000),
      tickEvent("t2", "BTC/USDT", 30_001, 30_002, 1_001),
      {
        eventId: "p1",
        type: "POOL_STATE_UPDATE",
        kind: "normalized",
        timestampMs: 1_002,
        source: "pancakeswap-v4-rpc",
        payload: {
          venue: "pancakeswap-v4",
          poolAddress: "0xpool",
          symbol: "BNB/USDT",
          timestampMs: 1_002,
          reserve0: 100,
          reserve1: 1_000,
          price: 10,
          liquidityUsd: 50_000,
        },
      },
    ];
    session.forEach((event) => bus.publish(event));
    const recorded = store.all();

    const folded = foldGraphState(recorded);
    const foldedFromReplay = foldGraphState(replayAll(store));

    // The live fold and the replayed fold agree bit for bit.
    expect(folded).toEqual(foldedFromReplay);
    expect(folded.version).toBe(3);
    expect(folded.nodes.map((node) => node.id).sort()).toEqual([
      "asset:BNB/USDT",
      "asset:BTC/USDT",
      "pool:0xpool",
      "venue:bybit",
      "venue:pancakeswap-v4",
    ]);
    expect(folded.edges).toHaveLength(2);

    // Deterministic: folding the same stream twice is identical.
    expect(foldGraphState(recorded)).toEqual(folded);
    expect(folded.snapshotId).toBe(foldGraphState(recorded).snapshotId);
  });

  test("AC3: sameEventStream detects differing payloads", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    bus.publish(tickEvent("t1", "BTC/USDT", 30_000, 30_001, 1_000));
    bus.publish(tickEvent("t2", "BTC/USDT", 30_001, 30_002, 1_001));

    const replay = replayAll(store);

    // Modify payload of the second stream's first event to simulate a different payload.
    const tampered = [
      replay[0],
      { ...replay[1], payload: { ...replay[1].payload, bid: 999_999 } },
    ];
    expect(sameEventStream(replay, tampered)).toBe(false);
  });

  test("makeEventId produces stable keys used for dedup", () => {
    const store = new EventStore(":memory:");
    const bus = new EventBus(store);
    const event = tickEvent(
      makeEventId(["bybit", "BTCUSDT", 42]),
      "BTC/USDT",
      30_000,
      30_001,
      1_000,
    );
    bus.publish(event);
    bus.publish(event);
    expect(store.count()).toBe(1);
  });
});