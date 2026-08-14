import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMarketDataSnapshot } from "../packages/contracts/src/index.ts";

/**
 * Workspace-level smoke test. Proves `bun test` runs across the workspace and
 * that every scaffold package resolves and can be imported.
 */
describe("workspace", () => {
  test("root smoke", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as { name: string; workspaces: string[] };
    expect(pkg.name).toBe("agenttrading");
    expect(pkg.workspaces).toContain("packages/*");

    expect(
      isMarketDataSnapshot({
        venue: "bybit",
        symbol: "BTC/USDT",
        timestampMs: 0,
        bid: 1,
        ask: 2,
        mid: 1.5,
        depth: 1,
        latencyMs: 1,
        source: "smoke",
      }),
    ).toBe(true);
  });
});
