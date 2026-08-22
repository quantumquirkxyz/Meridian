/**
 * @agenttrading/core — deterministic orchestration core (StateGraph, Risk,
 * Execution, Reconciliation, Inventory, Loops). ARCHITECTURE.md boundary:
 * core never imports LLMs or connectors; it only depends on contracts.
 */
/** Core package version string. */
export const CORE_VERSION = "0.1.0";

export * from "./stategraph/permission-registry.ts";
export * from "./stategraph/audit-log.ts";
export * from "./stategraph/guards.ts";
export * from "./stategraph/topology.ts";
export * from "./stategraph/state-graph.ts";
export * from "./risk/risk-gate.ts";
export * from "./execution/paper-execution-engine.ts";
export * from "./reconciliation/reconciliation-engine.ts";
export * from "./flow/simulated-flow.ts";
export * from "./loop/loop-runner.ts";
export * from "./loop/loop-engine.ts";
export * from "./stategraph/orchestrator.ts";
export * from "./inventory/inventory-engine.ts";
export * from "./beta/paper-trading-session.ts";
export * from "./gamma/kill-switch.ts";
export * from "./gamma/live-execution-engine.ts";
export * from "./gamma/canary-session.ts";
export * from "./gamma/regime-classifier.ts";
export * from "./gamma/regime-policy-engine.ts";
export * from "./gamma/stats.ts";
export * from "./gamma/trade-journal.ts";
export * from "./gamma/edge-decay-detector.ts";
export * from "./gamma/promotion-pipeline.ts";
export * from "./gamma/learning-engine.ts";
export * from "./gamma/route-engine.ts";
export * from "./gamma/systemic-risk-overlay.ts";
export * from "./gamma/infrastructure-engine.ts";
