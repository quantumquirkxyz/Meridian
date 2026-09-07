import { describe, expect, test } from "bun:test";
import {
  AUDIT_ACTIONS,
  AUDIT_REASON_CODES,
  DATA_QUALITY_STATES,
  OPPORTUNITY_STATUS,
  ORDER_SIDES,
  PERMISSIONS,
  PERMISSIONS_NEVER_GRANTED_TO_AGENTS,
  RISK_DECISION_OUTCOMES,
  RISK_REASON_CODES,
  STATE_NAMES,
  SYSTEM_MODES,
  isAuditEvent,
  isCostBreakdown,
  isDataQualityReport,
  isDataQualityState,
  isEdgeWeights,
  isGuardResult,
  isMarketDataSnapshot,
  isMarketEdge,
  isMarketGraphSnapshot,
  isMarketNode,
  isOpportunityCandidate,
  isOrderIntent,
  isOrderLimits,
  isPermission,
  isRiskDecision,
  isStateContext,
  isStateNode,
  isSystemMode,
  isTransition,
  isTransitionGuard,
  parseAuditEvent,
  parseDataQualityReport,
  parseMarketDataSnapshot,
  parseOpportunityCandidate,
  parseOrderIntent,
  parseRiskDecision,
} from "../src/index.ts";
import type {
  AuditEvent,
  DataQualityReport,
  MarketDataSnapshot,
  OpportunityCandidate,
  OrderIntent,
  RiskDecision,
} from "../src/index.ts";

const marketData: MarketDataSnapshot = {
  venue: "bybit",
  symbol: "BTC/USDT",
  timestampMs: 1_700_000_000_000,
  bid: 30_000,
  ask: 30_001,
  mid: 30_000.5,
  depth: 1_000_000,
  latencyMs: 12,
  source: "bybit-ws-linear",
};

describe("MarketDataSnapshot", () => {
  test("valid snapshot passes and parses", () => {
    expect(isMarketDataSnapshot(marketData)).toBe(true);
    expect(parseMarketDataSnapshot(marketData)).toEqual(marketData);
  });

  test("null bid/ask/mid accepted; missing symbol rejected", () => {
    expect(isMarketDataSnapshot({ ...marketData, bid: null, mid: null })).toBe(true);
    expect(isMarketDataSnapshot({ ...marketData, symbol: undefined })).toBe(false);
  });

  test("workspace smoke payload validates", () => {
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

function makeCostBreakdown() {
  return {
    tradingFeesUsd: 10,
    slippageUsd: 5,
    gasUsd: 2,
    bridgeCostUsd: 0,
    fundingCostUsd: 0,
    latencyRiskUsd: 1,
    failureRiskUsd: 2,
    safetyBufferUsd: 10,
  };
}

function makeApprovalLimits() {
  return { maxSlippageBps: 5 };
}

describe("DataQualityReport", () => {
  test("valid report passes", () => {
    const report: DataQualityReport = {
      source: "bybit-ws-linear",
      state: "HEALTHY",
      score: 0.99,
      updatedAtMs: 1_700_000_000_000,
      lastSeenMs: 1_699_999_999_000,
    };
    expect(isDataQualityReport(report)).toBe(true);
    expect(parseDataQualityReport(report)).toEqual(report);
  });

  test("unknown state rejected", () => {
    expect(isDataQualityState("HEALTHY")).toBe(true);
    expect(isDataQualityState("BROKEN")).toBe(false);
    expect(DATA_QUALITY_STATES).toContain("STALE");
  });
});

describe("MarketGraphSnapshot", () => {
  test("valid snapshot passes", () => {
    const snapshot = {
      version: 1,
      snapshotId: "snap-1",
      createdAtMs: 1_700_000_000_000,
      nodes: [{ id: "asset:BTC", type: "ASSET" }],
      edges: [
        {
          id: "e1",
          from: "asset:BTC",
          to: "venue:bybit",
          type: "ORDER_BOOK",
          weights: {
            price: 30_000,
            fee: 10,
            gasCost: 0,
            expectedSlippage: 5,
            latencyMs: 12,
            liquidityUsd: 1_000_000,
            failureProbability: 0.01,
            confidence: 0.99,
            riskScore: 0.1,
          },
          tradable: true,
          source: "bybit-ws",
        },
      ],
    };
    expect(isMarketNode(snapshot.nodes[0])).toBe(true);
    expect(isEdgeWeights(snapshot.edges[0].weights)).toBe(true);
    expect(isMarketEdge(snapshot.edges[0])).toBe(true);
    expect(isMarketGraphSnapshot(snapshot)).toBe(true);
  });

  test("non-tradable edge is valid; bad weight rejected", () => {
    expect(isMarketGraphSnapshot({ version: 1, snapshotId: "s", createdAtMs: 0, nodes: [], edges: [] })).toBe(true);
    expect(isEdgeWeights({ failureProbability: 2 })).toBe(false);
  });

  test("bridgeCostUsd is an optional dedicated weight on edges", () => {
    expect(isEdgeWeights({ bridgeCostUsd: 0.5 })).toBe(true);
    expect(isEdgeWeights({ bridgeCostUsd: 0 })).toBe(true);
    expect(isEdgeWeights({ bridgeCostUsd: "high" })).toBe(false);
    // Existing weight shapes still parse without the new field (expand, non-breaking).
    expect(
      isEdgeWeights({
        price: 30_000,
        fee: 10,
        gasCost: 0,
        expectedSlippage: 5,
        latencyMs: 12,
        liquidityUsd: 1_000_000,
        failureProbability: 0.01,
        confidence: 0.99,
        riskScore: 0.1,
      }),
    ).toBe(true);
  });
});

describe("OpportunityCandidate", () => {
  test("valid candidate passes and parses", () => {
    const candidate: OpportunityCandidate = {
      id: "c1",
      snapshotId: "snap-1",
      route: ["asset:BTC", "venue:bybit", "asset:BTC"],
      grossSpreadUsd: 100,
      costs: makeCostBreakdown(),
      expectedNetProfitUsd: 70,
      createdAtMs: 1_700_000_000_000,
      status: "CANDIDATE",
      invalidationReasons: [],
    };
    expect(isCostBreakdown(candidate.costs)).toBe(true);
    expect(isOpportunityCandidate(candidate)).toBe(true);
    expect(parseOpportunityCandidate(candidate)).toEqual(candidate);
    expect(OPPORTUNITY_STATUS).toContain("CANDIDATE");
  });

  test("route must be strings", () => {
    expect(isOpportunityCandidate({ ...validCandidate(), route: [1] })).toBe(false);
  });

  test("REJECTED/INVALID candidates must carry reason codes", () => {
    expect(
      isOpportunityCandidate({
        ...validCandidate(),
        status: "REJECTED",
        invalidationReasons: [],
      }),
    ).toBe(false);
    expect(
      isOpportunityCandidate({
        ...validCandidate(),
        status: "REJECTED",
        invalidationReasons: ["MIN_EDGE"],
      }),
    ).toBe(true);
    expect(
      isOpportunityCandidate({
        ...validCandidate(),
        status: "INVALID",
        invalidationReasons: undefined,
      }),
    ).toBe(false);
  });
});

describe("OrderIntent", () => {
  test("valid intent passes and parses", () => {
    const intent: OrderIntent = {
      idempotencyKey: "k1",
      opportunityId: "c1",
      venue: "bybit",
      symbol: "BTC/USDT",
      side: "BUY",
      quantity: 0.01,
      price: 30_000,
      quoteCurrency: "USDT",
      createdAtMs: 1_700_000_000_000,
      expiresAtMs: 1_700_000_060_000,
      limits: makeApprovalLimits(),
    };
    expect(isOrderLimits(intent.limits)).toBe(true);
    expect(isOrderIntent(intent)).toBe(true);
    expect(parseOrderIntent(intent)).toEqual(intent);
    expect(ORDER_SIDES).toContain("BUY");
  });

  test("APPROVE without limits or expiry is rejected", () => {
    expect(
      isRiskDecision({
        decision: "APPROVE",
        orderIntentIdempotencyKey: "k1",
        evaluatedAtMs: 0,
        approvedSize: 0.01,
      }),
    ).toBe(false);
  });

  test("bad side rejected", () => {
    expect(isOrderIntent({ ...validIntent(), side: "HOLD" })).toBe(false);
  });
});

describe("RiskDecision", () => {
  test("rejection carries reason codes", () => {
    const decision: RiskDecision = {
      decision: "REJECT",
      orderIntentIdempotencyKey: "k1",
      reasonCodes: ["MIN_EDGE", "MAX_SLIPPAGE"],
      evaluatedAtMs: 1_700_000_000_000,
    };
    expect(isRiskDecision(decision)).toBe(true);
    expect(parseRiskDecision(decision)).toEqual(decision);
    expect(RISK_DECISION_OUTCOMES).toContain("REJECT");
    expect(RISK_REASON_CODES).toContain("MIN_EDGE");
  });

  test("unknown reason code rejected", () => {
    expect(isRiskDecision({ ...validDecision(), reasonCodes: ["NOPE"] })).toBe(false);
  });

  test("rejection without reason codes is rejected", () => {
    expect(isRiskDecision({ ...validDecision(), reasonCodes: [] })).toBe(false);
  });

  test("defensive decision without reason codes is rejected", () => {
    expect(
      isRiskDecision({
        decision: "CASH_ONLY",
        orderIntentIdempotencyKey: "k1",
        reasonCodes: [],
        evaluatedAtMs: 1_700_000_000_000,
      }),
    ).toBe(false);
  });

  test("reduction without reason codes is rejected", () => {
    expect(
      isRiskDecision({
        ...validReduceDecision(),
        reasonCodes: [],
      }),
    ).toBe(false);
  });

  test("approve without reason codes is valid", () => {
    expect(
      isRiskDecision({
        decision: "APPROVE",
        orderIntentIdempotencyKey: "k1",
        reasonCodes: [],
        evaluatedAtMs: 0,
        approvedSize: 0.01,
        approvedLimits: makeApprovalLimits(),
        expiresAtMs: 1_700_000_000_000,
      }),
    ).toBe(true);
  });

  test("approvedLimits is validated against the OrderLimits shape", () => {
    expect(
      isRiskDecision({
        decision: "APPROVE",
        orderIntentIdempotencyKey: "k1",
        evaluatedAtMs: 0,
        approvedSize: 0.01,
        approvedLimits: { maxSlippageBps: "high" },
        expiresAtMs: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      isRiskDecision({
        decision: "APPROVE",
        orderIntentIdempotencyKey: "k1",
        evaluatedAtMs: 0,
        approvedSize: 0.01,
        approvedLimits: { minDataQuality: "BROKEN" },
        expiresAtMs: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      isRiskDecision({
        decision: "APPROVE",
        orderIntentIdempotencyKey: "k1",
        evaluatedAtMs: 0,
        approvedSize: 0.01,
        approvedLimits: { minDataQuality: "HEALTHY" },
        expiresAtMs: 1_700_000_000_000,
      }),
    ).toBe(true);
  });
});

describe("AuditEvent", () => {
  test("valid audit event passes", () => {
    const event: AuditEvent = {
      eventId: "audit-1",
      sequence: 7,
      timestampMs: 1_700_000_000_000,
      action: "STATE_TRANSITION",
      actor: "stategraph",
      state: "RISK_VALIDATE",
    };
    expect(isAuditEvent(event)).toBe(true);
    expect(parseAuditEvent(event)).toEqual(event);
    expect(AUDIT_ACTIONS).toContain("RISK_DECISION");
  });

  test("state must be a known StateName", () => {
    expect(isAuditEvent({ ...validAuditEvent(), state: "NOT_A_STATE" })).toBe(false);
  });

  test("audit events carry machine-readable reason codes", () => {
    const event = {
      ...validAuditEvent(),
      reasonCodes: ["TRANSITION_ALLOWED", "DEFENSIVE_MODE_ENTERED"],
    };
    expect(isAuditEvent(event)).toBe(true);
    expect(isAuditEvent({ ...event, reasonCodes: ["NOT_A_CODE"] })).toBe(false);
    expect(AUDIT_REASON_CODES).toContain("TRANSITION_BLOCKED");
    expect(AUDIT_REASON_CODES).toContain("RISK_APPROVED");
  });
});

describe("Permission", () => {
  test("isPermission is reachable from the package entry", () => {
    expect(isPermission("APPROVE_RISK")).toBe(true);
    expect(isPermission("TRADE_STOCKS")).toBe(false);
    expect(PERMISSIONS_NEVER_GRANTED_TO_AGENTS.every(isPermission)).toBe(true);
  });

  test("defensive-mode trigger permissions exist", () => {
    for (const permission of [
      "TRIGGER_DEGRADED_MODE",
      "TRIGGER_CANCEL_ONLY",
      "TRIGGER_REDUCE_ONLY",
      "TRIGGER_CASH_ONLY",
      "TRIGGER_HALT",
    ]) {
      expect(isPermission(permission)).toBe(true);
    }
    // Execution-authority permissions are still never granted to agents.
    for (const permission of PERMISSIONS_NEVER_GRANTED_TO_AGENTS) {
      expect(isPermission(permission)).toBe(true);
    }
  });
});

describe("SystemMode", () => {
  test("modes are as documented", () => {
    expect(SYSTEM_MODES).toEqual([
      "NORMAL",
      "OBSERVE_ONLY",
      "SIGNAL_ONLY",
      "CANCEL_ONLY",
      "REDUCE_ONLY",
      "CASH_ONLY",
      "HALT",
    ]);
    expect(isSystemMode("HALT")).toBe(true);
    expect(isSystemMode("TRADING")).toBe(false);
  });
});

describe("StateGraph contracts", () => {
  test("state names include flow and defensive modes", () => {
    expect(STATE_NAMES).toContain("RISK_VALIDATE");
    expect(STATE_NAMES).toContain("DEGRADED_MODE");
    expect(STATE_NAMES).toContain("HALT");
  });

  test("state context validates", () => {
    const ctx = {
      state: "RISK_VALIDATE",
      mode: "NORMAL",
      updatedAtMs: 1_700_000_000_000,
    };
    expect(isStateContext(ctx)).toBe(true);
    expect(isStateContext({ ...ctx, state: "NOPE" })).toBe(false);
  });

  test("state node validates with name and optional description", () => {
    const node = {
      name: "RISK_VALIDATE",
      description: "risk validation state",
    };
    expect(isStateNode(node)).toBe(true);
    expect(isStateNode({ name: "RISK_VALIDATE" })).toBe(true);
    expect(isStateNode({ name: "NOPE" })).toBe(false);
  });

  test("permission model: execution permissions never granted to agents", () => {
    for (const p of PERMISSIONS_NEVER_GRANTED_TO_AGENTS) {
      expect(PERMISSIONS).toContain(p);
    }
    expect(PERMISSIONS_NEVER_GRANTED_TO_AGENTS).toEqual(
      expect.arrayContaining(["APPROVE_RISK", "SUBMIT_ORDER", "SIGN_TRANSACTION", "MOVE_FUNDS", "MODIFY_RISK_LIMITS"]),
    );
  });

  test("transition and guard validate", () => {
    const guard = {
      name: "riskApproved",
      evaluate: (ctx: { state: string }) => ({
        ok: true,
      }),
    };
    expect(isTransitionGuard(guard)).toBe(true);
    const transition = {
      id: "risk-execute",
      from: "RISK_VALIDATE",
      to: "EXECUTION_PRECHECK",
      guard,
      requiredPermissions: ["APPROVE_RISK"],
      audit: true,
    };
    expect(isTransition(transition)).toBe(true);
  });

  test("audit is mandatory for every transition", () => {
    const base = {
      id: "risk-execute",
      from: "RISK_VALIDATE",
      to: "EXECUTION_PRECHECK",
      guard: { name: "minEdge", evaluate: () => true },
      requiredPermissions: ["APPROVE_RISK"],
    };
    expect(isTransition({ ...base, audit: true })).toBe(true);
    expect(isTransition({ ...base, audit: false })).toBe(false);
  });

  test("guard results validate both branches", () => {
    expect(isGuardResult({ ok: true })).toBe(true);
    expect(isGuardResult({ ok: false, reason: "below edge" })).toBe(true);
    expect(isGuardResult({ ok: "yes" })).toBe(false);
  });
});

describe("deterministic flow (story 30: no LLM)", () => {
  test("candidate -> intent -> approve/reject/reduce validates end to end", () => {
    const candidate = validCandidate();
    const intent = validIntent();

    expect(isOpportunityCandidate(candidate)).toBe(true);
    expect(isOrderIntent(intent)).toBe(true);
    expect(isRiskDecision({
      decision: "APPROVE",
      orderIntentIdempotencyKey: intent.idempotencyKey,
      reasonCodes: [],
      evaluatedAtMs: 1_700_000_000_000,
      approvedSize: 0.01,
      approvedLimits: { maxSlippageBps: 5 },
      expiresAtMs: 1_700_000_060_000,
    })).toBe(true);
    expect(isRiskDecision(validDecision())).toBe(true);
    expect(isRiskDecision(validReduceDecision())).toBe(true);
  });
});

function validCandidate() {
  return {
    id: "c1",
    snapshotId: "snap-1",
    route: ["a", "b"],
    grossSpreadUsd: 100,
    costs: {
      tradingFeesUsd: 10,
      slippageUsd: 5,
      gasUsd: 2,
      bridgeCostUsd: 0,
      fundingCostUsd: 0,
      latencyRiskUsd: 1,
      failureRiskUsd: 2,
      safetyBufferUsd: 10,
    },
    expectedNetProfitUsd: 70,
    createdAtMs: 1_700_000_000_000,
    status: "CANDIDATE" as const,
    invalidationReasons: [],
  };
}

function validIntent() {
  return {
    idempotencyKey: "k1",
    opportunityId: "c1",
    venue: "bybit",
    symbol: "BTC/USDT",
    side: "BUY" as const,
    quantity: 0.01,
    price: 30_000,
    quoteCurrency: "USDT",
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: 1_700_000_060_000,
    limits: { maxSlippageBps: 5 },
  };
}

function validDecision() {
  return {
    decision: "REJECT" as const,
    orderIntentIdempotencyKey: "k1",
    reasonCodes: ["MIN_EDGE"],
    evaluatedAtMs: 1_700_000_000_000,
  };
}

function validReduceDecision() {
  return {
    decision: "REDUCE_SIZE" as const,
    orderIntentIdempotencyKey: "k1",
    reasonCodes: ["MIN_EDGE"],
    evaluatedAtMs: 1_700_000_000_000,
    approvedSize: 0.01,
    approvedLimits: { maxSlippageBps: 5 },
    expiresAtMs: 1_700_000_060_000,
  };
}

function validAuditEvent(): AuditEvent {
  return {
    eventId: "audit-1",
    sequence: 7,
    timestampMs: 1_700_000_000_000,
    action: "STATE_TRANSITION",
    actor: "stategraph",
    state: "RISK_VALIDATE",
  };
}
