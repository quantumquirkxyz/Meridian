import { describe, expect, test } from "bun:test";
import { isSystemMode } from "@agenttrading/contracts";
import {
  ReconciliationEngine,
  type ReconciliationSnapshot,
} from "../src/reconciliation/reconciliation-engine.ts";

const FIXED_TS = 1_700_000_000_000;

function snapshot(overrides: Partial<ReconciliationSnapshot> = {}): ReconciliationSnapshot {
  return {
    orders: [],
    fills: [],
    positions: [],
    balances: [],
    ...overrides,
  };
}

describe("ReconciliationEngine", () => {
  test("detects orphan orders and activates cancel-only mode", () => {
    const engine = new ReconciliationEngine();
    const report = engine.reconcile({
      internal: snapshot({
        orders: [{ orderId: "order-1", status: "OPEN", quantity: 10, filledQuantity: 0 }],
      }),
      external: snapshot(),
      reconciledAtMs: FIXED_TS,
    });

    expect(report.unresolved).toBe(true);
    expect(report.orphanOrders).toEqual(["order-1"]);
    expect(report.missingFills).toEqual([]);
    expect(report.balanceMismatches).toEqual([]);
    expect(report.positionMismatches).toEqual([]);
    expect(report.defensiveMode).toBe("CANCEL_ONLY");
    expect(report.blocksNewPositions).toBe(true);
    expect(report.reasonCodes).toContain("RECONCILIATION_MISMATCH");
    expect(isSystemMode(report.defensiveMode)).toBe(true);
  });

  test("detects missing fills and activates cancel-only mode", () => {
    const engine = new ReconciliationEngine();
    const report = engine.reconcile({
      internal: snapshot({
        fills: [{ fillId: "fill-1", orderId: "order-1", quantity: 2, price: 100 }],
      }),
      external: snapshot(),
      reconciledAtMs: FIXED_TS,
    });

    expect(report.unresolved).toBe(true);
    expect(report.missingFills).toEqual(["fill-1"]);
    expect(report.defensiveMode).toBe("CANCEL_ONLY");
  });

  test("detects balance and position mismatches and activates reduce-only mode", () => {
    const engine = new ReconciliationEngine();
    const report = engine.reconcile({
      internal: snapshot({
        positions: [
          { symbol: "BTC/USDT", quantity: 1, averagePrice: 100 },
        ],
        balances: [
          { asset: "USDT", available: 1_000, locked: 25 },
        ],
      }),
      external: snapshot({
        positions: [
          { symbol: "BTC/USDT", quantity: 0.5, averagePrice: 101 },
        ],
        balances: [
          { asset: "USDT", available: 900, locked: 25 },
        ],
      }),
      reconciledAtMs: FIXED_TS,
    });

    expect(report.unresolved).toBe(true);
    expect(report.positionMismatches).toEqual(["BTC/USDT"]);
    expect(report.balanceMismatches).toEqual(["USDT"]);
    expect(report.defensiveMode).toBe("REDUCE_ONLY");
    expect(report.blocksNewPositions).toBe(true);
  });

  test("stays normal when books match", () => {
    const engine = new ReconciliationEngine();
    const report = engine.reconcile({
      internal: snapshot({
        balances: [{ asset: "USDT", available: 1_000, locked: 0 }],
      }),
      external: snapshot({
        balances: [{ asset: "USDT", available: 1_000, locked: 0 }],
      }),
      reconciledAtMs: FIXED_TS,
    });

    expect(report.unresolved).toBe(false);
    expect(report.defensiveMode).toBe("NORMAL");
    expect(report.reasonCodes).toEqual(["RECONCILIATION_OK"]);
  });

  test("runs after every order and periodically based on cadence", () => {
    const engine = new ReconciliationEngine();

    expect(
      engine.shouldReconcile({
        nowMs: FIXED_TS,
        afterOrderEvent: true,
      }),
    ).toBe(true);
    expect(
      engine.shouldReconcile({
        nowMs: FIXED_TS,
        lastReconciledAtMs: FIXED_TS - 10_000,
        intervalMs: 30_000,
      }),
    ).toBe(false);
    expect(
      engine.shouldReconcile({
        nowMs: FIXED_TS,
        lastReconciledAtMs: FIXED_TS - 31_000,
        intervalMs: 30_000,
      }),
    ).toBe(true);
  });
});
