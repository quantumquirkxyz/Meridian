/**
 * @agenttrading/core/live — unified LiveRunner (ADR-0011).
 *
 * Only module in core that imports connectors (@agenttrading/connectors).
 * All other core modules remain exchange-agnostic.
 */
export * from "./live-runner-types.ts";
