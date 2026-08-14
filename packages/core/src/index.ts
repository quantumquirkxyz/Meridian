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
export * from "./flow/simulated-flow.ts";
