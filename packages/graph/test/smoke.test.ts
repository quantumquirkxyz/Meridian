import { describe, expect, test } from "bun:test";
import { GRAPH_VERSION } from "../src/index.ts";
import { isMarketGraphSnapshot } from "@agenttrading/contracts";

describe("@agenttrading/graph smoke", () => {
  test("package resolves", () => {
    expect(GRAPH_VERSION).toBe("0.1.0");
  });

  test("graph snapshot shape comes from contracts", () => {
    const snapshot = {
      version: 1,
      snapshotId: "snap-1",
      createdAtMs: 0,
      nodes: [{ id: "asset:BTC", type: "ASSET" }],
      edges: [],
    };
    expect(isMarketGraphSnapshot(snapshot)).toBe(true);
  });
});
