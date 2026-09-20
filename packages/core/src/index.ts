/**
 * @agenttrading/core — deterministic orchestration core (StateGraph, Risk,
 * Execution, Reconciliation, Inventory, Loops). ARCHITECTURE.md boundary:
 * core never imports LLMs or connectors; it only depends on contracts.
 */
/** Core package version string. */
export const CORE_VERSION = "0.1.0";

export * from "./stategraph/state-graph.ts";
export * from "./risk/risk-gate.ts";
export * from "./risk/mev-protection.ts";
export * from "./risk/price-oracle.ts";
export * from "./risk/bridge-manager.ts";
export * from "./execution/simulated-execution-engine.ts";
export * from "./execution/audit-logger.ts";
export * from "./execution/trade-record.ts";
export * from "./execution/session-report.ts";
export * from "./reconciliation/reconciliation-engine.ts";
export * from "./flow/simulated-flow.ts";
export * from "./loop/loop-runner.ts";
export * from "./loop/loop-engine.ts";
export * from "./inventory/inventory-engine.ts";

export * from "./live/kill-switch.ts";
export * from "./live/live-execution-engine.ts";
export * from "./live/canary-session.ts";
export * from "./live/regime-classifier.ts";
export * from "./live/regime-policy-engine.ts";
export * from "./live/stats.ts";
export * from "./live/trade-journal.ts";
export * from "./live/edge-decay-detector.ts";
export * from "./live/promotion-pipeline.ts";
export * from "./live/learning-engine.ts";
export * from "./live/route-engine.ts";
export * from "./live/systemic-risk-overlay.ts";
export * from "./live/audit-reconstructor.ts";
export * from "./live/report-generator.ts";
export * from "./live/audit-exporter.ts";
export * from "./live/audit-availability.ts";
export * from "./live/opportunity-detector.ts";
export * from "./live/trading-session.ts";
export * from "./utils/slippage.ts";
export * from "./utils/market-state.ts";

