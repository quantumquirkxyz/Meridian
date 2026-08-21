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
