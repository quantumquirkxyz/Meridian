import type { AuditReasonCode, SystemMode } from "@agenttrading/contracts";

export type ReconciliationSeverity = "NONE" | "SOFT" | "HARD";

export interface ReconciliationOrderState {
  orderId: string;
  status: "OPEN" | "CLOSED" | "CANCELLED" | "REJECTED";
  quantity: number;
  filledQuantity: number;
}

export interface ReconciliationFillState {
  fillId: string;
  orderId: string;
  quantity: number;
  price: number;
}

export interface ReconciliationPositionState {
  symbol: string;
  quantity: number;
  averagePrice: number;
}

export interface ReconciliationBalanceState {
  asset: string;
  available: number;
  locked: number;
}

export interface ReconciliationSnapshot {
  orders: readonly ReconciliationOrderState[];
  fills: readonly ReconciliationFillState[];
  positions: readonly ReconciliationPositionState[];
  balances: readonly ReconciliationBalanceState[];
}

export interface ReconciliationReport {
  reconciledAtMs: number;
  unresolved: boolean;
  severity: ReconciliationSeverity;
  defensiveMode: SystemMode;
  reasonCodes: readonly AuditReasonCode[];
  orphanOrders: readonly string[];
  missingFills: readonly string[];
  balanceMismatches: readonly string[];
  positionMismatches: readonly string[];
  /** True when the report should prevent new positions until resolved. */
  blocksNewPositions: boolean;
}

export interface ReconciliationEngineInput {
  internal: ReconciliationSnapshot;
  external: ReconciliationSnapshot;
  reconciledAtMs: number;
  /** Periodic cadence used by `shouldReconcile`. */
  intervalMs?: number;
  /** Last successful or attempted reconciliation timestamp. */
  lastReconciledAtMs?: number;
}

function indexBy<T>(
  values: readonly T[],
  key: keyof T,
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    const raw = value[key];
    if (typeof raw !== "string") {
      throw new Error(`reconciliation key ${String(key)} must be a string`);
    }
    indexed.set(raw, value);
  }
  return indexed;
}

function approximatelyEqual(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance;
}

function uniqueReasons(reasons: AuditReasonCode[]): AuditReasonCode[] {
  return [...new Set(reasons)];
}

/**
 * Deterministic reconciliation engine.
 *
 * The internal state is the book the system believes it has. The external
 * state is what the venue / chain / wallet reports. Any discrepancy is a
 * control-system error: we classify it by severity and choose the most
 * conservative mode that can still preserve observability.
 */
export class ReconciliationEngine {
  shouldReconcile(input: {
    nowMs: number;
    lastReconciledAtMs?: number;
    intervalMs?: number;
    afterOrderEvent?: boolean;
  }): boolean {
    if (input.afterOrderEvent) {
      return true;
    }
    const intervalMs = input.intervalMs ?? 30_000;
    if (input.lastReconciledAtMs === undefined) {
      return true;
    }
    return input.nowMs - input.lastReconciledAtMs >= intervalMs;
  }

  reconcile(input: ReconciliationEngineInput): ReconciliationReport {
    const internalOrders = indexBy(input.internal.orders, "orderId");
    const externalOrders = indexBy(input.external.orders, "orderId");
    const internalFills = indexBy(input.internal.fills, "fillId");
    const externalFills = indexBy(input.external.fills, "fillId");
    const internalPositions = indexBy(input.internal.positions, "symbol");
    const externalPositions = indexBy(input.external.positions, "symbol");
    const internalBalances = indexBy(input.internal.balances, "asset");
    const externalBalances = indexBy(input.external.balances, "asset");

    const orphanOrders: string[] = [];
    const missingFills: string[] = [];
    const balanceMismatches: string[] = [];
    const positionMismatches: string[] = [];

    for (const [orderId] of internalOrders) {
      if (!externalOrders.has(orderId)) {
        orphanOrders.push(orderId);
      }
    }

    for (const [fillId] of internalFills) {
      if (!externalFills.has(fillId)) {
        missingFills.push(fillId);
      }
    }

    for (const [asset, internalBalance] of internalBalances) {
      const externalBalance = externalBalances.get(asset);
      if (
        !externalBalance ||
        !approximatelyEqual(internalBalance.available, externalBalance.available) ||
        !approximatelyEqual(internalBalance.locked, externalBalance.locked)
      ) {
        balanceMismatches.push(asset);
      }
    }

    for (const [symbol, internalPosition] of internalPositions) {
      const externalPosition = externalPositions.get(symbol);
      if (
        !externalPosition ||
        !approximatelyEqual(internalPosition.quantity, externalPosition.quantity) ||
        !approximatelyEqual(
          internalPosition.averagePrice,
          externalPosition.averagePrice,
        )
      ) {
        positionMismatches.push(symbol);
      }
    }

    const hasHardMismatch =
      orphanOrders.length > 0 || missingFills.length > 0;
    const hasSoftMismatch =
      balanceMismatches.length > 0 || positionMismatches.length > 0;
    const unresolved = hasHardMismatch || hasSoftMismatch;

    const severity: ReconciliationSeverity = hasHardMismatch
      ? "HARD"
      : hasSoftMismatch
        ? "SOFT"
        : "NONE";

    const defensiveMode: SystemMode = !unresolved
      ? "NORMAL"
      : hasHardMismatch && hasSoftMismatch
        ? "HALT"
        : hasHardMismatch
          ? "CANCEL_ONLY"
          : "REDUCE_ONLY";

    const reasonCodes = uniqueReasons(
      [
        ...(hasHardMismatch ? ["RECONCILIATION_MISMATCH"] : []),
        ...(hasSoftMismatch ? ["RECONCILIATION_MISMATCH"] : []),
      ] as AuditReasonCode[],
    );

    return {
      reconciledAtMs: input.reconciledAtMs,
      unresolved,
      severity,
      defensiveMode,
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["RECONCILIATION_OK"],
      orphanOrders,
      missingFills,
      balanceMismatches,
      positionMismatches,
      blocksNewPositions: unresolved,
    };
  }
}
