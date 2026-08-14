import { describe, expect, test } from "bun:test";
import { GRAPH_VERSION } from "../src/index.ts";
import { isMarketGraphSnapshot } from "@agenttrading/contracts";
import { expectPackageSmoke } from "../../../test/smoke-helper.ts";

describe("@agenttrading/graph smoke", () => {
  test("package resolves", () => {
    expectPackageSmoke(GRAPH_VERSION, () => {
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
});
