/**
 * @agenttrading/contracts — the shared typed frontier of the AgentTrading
 * system (ADR-0001). Dependency-free: no LLM or framework runtime.
 *
 * Exposes the base contracts (MarketDataSnapshot, DataQualityReport,
 * MarketGraphSnapshot, OpportunityCandidate, OrderIntent, RiskDecision,
 * AuditEvent, StateGraph types, Permission, SystemMode) and shared reason
 * codes, each with TypeScript types and runtime schema validation.
 */

export * from "./schema.ts";
export * from "./market-data.ts";
export * from "./data-quality.ts";
export * from "./graph.ts";
export * from "./opportunity.ts";
export * from "./limits.ts";
export * from "./order.ts";
export * from "./risk.ts";
export * from "./reason-codes.ts";
export * from "./audit.ts";
export * from "./modes.ts";
export * from "./stategraph.ts";
export * from "./events.ts";
export * from "./loop.ts";
