import { expect } from "bun:test";
import { type StateName, type SystemMode } from "@agenttrading/contracts";
import { AuditLog } from "../src/stategraph/audit-log.ts";
import { StateGraph } from "../src/stategraph/state-graph.ts";
import {
  buildDefaultGraph,
  defaultPermissionRegistry,
  MODULE_ACTORS,
} from "../src/stategraph/topology.ts";

/** Canonical observation steps up to BUILD_ORDER_INTENT. */
export const CANDIDATE_CYCLE: ReadonlyArray<
  [StateName, string, Record<string, unknown>]
> = [
  ["INGEST_MARKET_DATA", MODULE_ACTORS.marketDataSentinel, { source: "bybit" }],
  ["NORMALIZE_MARKET_STATE", MODULE_ACTORS.normalizer, { normalizedMarketData: { mid: 1 } }],
  ["UPDATE_MARKET_GRAPH", MODULE_ACTORS.graphBuilder, { graphSnapshot: { version: 1 } }],
  [
    "DETECT_OPPORTUNITY",
    MODULE_ACTORS.opportunityScanner,
    { candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }] },
  ],
  [
    "BUILD_ORDER_INTENT",
    MODULE_ACTORS.opportunityScanner,
    { candidates: [{ status: "CANDIDATE", expectedNetProfitUsd: 5 }] },
  ],
];

/** Canonical cycle up to RISK_VALIDATE, the risk-gate entry point. */
export const RISK_CYCLE: ReadonlyArray<
  [StateName, string, Record<string, unknown>]
> = [
  ...CANDIDATE_CYCLE,
  ["REQUEST_AGENT_REVIEW", MODULE_ACTORS.planner, { orderIntent: {} }],
  ["RISK_VALIDATE", MODULE_ACTORS.agentReview, { agentReview: "PASS" }],
];

/** Shared fixed timestamp for deterministic tests. */
export const FIXED_TS = 1_700_000_000_000;

/** Creates a fresh StateGraph with the default topology and permissions. */
export function newGraph(options?: {
  now?: () => number;
  initialMode?: SystemMode;
}): { graph: StateGraph; audit: AuditLog } {
  const { nodes, transitions } = buildDefaultGraph();
  const audit = new AuditLog();
  const graph = new StateGraph({
    nodes,
    transitions,
    permissions: defaultPermissionRegistry(),
    audit,
    now: options?.now ?? (() => FIXED_TS),
    initialMode: options?.initialMode,
  });
  return { graph, audit };
}

/** Walks a StateGraph through the given steps, expecting each to be allowed. */
export function walkSteps(
  graph: StateGraph,
  steps: ReadonlyArray<[StateName, string, Record<string, unknown>]>,
  timestampMs = 0,
): void {
  for (const [to, actor, data] of steps) {
    expect(graph.transition({ to, actor, data, timestampMs }).ok).toBe(true);
  }
}

/** Walks the canonical flow up to BUILD_ORDER_INTENT. */
export function walkToBuildIntent(graph: StateGraph): void {
  walkSteps(graph, CANDIDATE_CYCLE);
}

/** Walks the canonical flow up to RISK_VALIDATE. */
export function walkToRiskValidate(graph: StateGraph): void {
  walkSteps(graph, RISK_CYCLE);
}
