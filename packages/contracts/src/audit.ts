import {
  isArrayOf,
  isEnumOf,
  isFreeformRecord,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isStateName, type StateName } from "./stategraph.ts";

/**
 * AuditEvent: recorded for every meaningful state transition and decision so
 * that every step is reconstructable (ADR-0003, user story 27).
 */
export const AUDIT_ACTIONS = [
  "STATE_TRANSITION",
  "RISK_DECISION",
  "ORDER_INTENT_CREATED",
  "OPPORTUNITY_DETECTED",
  "OPPORTUNITY_RECORDED",
  "CONNECTOR_EVENT",
  "GRAPH_UPDATE",
  "DATA_QUALITY_EVENT",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Machine-readable reason codes attached to every audit event. Every StateGraph
 * transition (allowed or blocked) carries at least one code so the audit trail
 * is reconstructable without parsing free text (issue #13, ARCHITECTURE.md:41).
 */
export const AUDIT_REASON_CODES = [
  "TRANSITION_ALLOWED",
  "TRANSITION_BLOCKED",
  "GUARD_FAILED",
  "PERMISSION_DENIED",
  "INVALID_TRANSITION",
  "DEFENSIVE_MODE_ENTERED",
  "MODE_REDUCED",
  "OPPORTUNITY_RECORDED",
  "ORDER_INTENT_CREATED",
  "RISK_APPROVED",
  "RISK_REJECTED",
  "EXECUTION_SIMULATED",
  "RECONCILIATION_OK",
  "CYCLE_COMPLETE",
  "CONNECTOR_PUBLISHED",
  "CONNECTOR_SUBSCRIBED",
  "GRAPH_NODE_UPSERTED",
  "GRAPH_EDGE_UPSERTED",
  "DATA_QUALITY_EVALUATED",
  "LOOP_STOPPED",
  "DATA_SOURCE_HALTED",
  "GRAPH_STALE",
  "RECONCILIATION_MISMATCH",
  // Orchestrator reason codes (issue #25)
  "KILL_SWITCH_ACTIVE",
  "KILL_SWITCH_ACTIVATED",
  "FORBIDDEN_ROUTE",
  "ORCHESTRATED",
  "TIMEOUT_TRIGGERED",
  "TIMEOUT_FALLBACK_FAILED",
  "FALLBACK_EXECUTED",
  "FALLBACK_FAILED",
  "MAX_RETRIES_EXCEEDED",
  "RETRY_QUEUED",
  "DEGRADED_MODE_ENTERED",
] as const;

export type AuditReasonCode = (typeof AUDIT_REASON_CODES)[number];

export interface AuditEvent {
  /** Idempotency key (e.g. uuid) for dedup/replay. */
  eventId: string;
  /** Monotonic sequence number in the audit store. */
  sequence: number;
  timestampMs: number;
  action: AuditAction;
  /** Actor id: module or agent (never a human-passable free string). */
  actor: string;
  /** Resulting StateName when action is STATE_TRANSITION. */
  state?: StateName;
  /** Structured detail (transition id, decision, reason codes, ...). */
  data?: Record<string, unknown>;
  /** Why this event happened (machine-readable), e.g. transition reason. */
  reasonCodes?: AuditReasonCode[];
}

const isAuditAction: Validator<AuditAction> = isEnumOf(AUDIT_ACTIONS);
export const isAuditReasonCode: Validator<AuditReasonCode> =
  isEnumOf(AUDIT_REASON_CODES);

export const isAuditEvent: Validator<AuditEvent> = isObjectOf({
  eventId: isString,
  sequence: isNumber,
  timestampMs: isNumber,
  action: isAuditAction,
  actor: isString,
  state: isOptional(isStateName),
  data: isOptional(isFreeformRecord),
  reasonCodes: isOptional(isArrayOf(isAuditReasonCode)),
});

export function parseAuditEvent(value: unknown): AuditEvent {
  return parse(isAuditEvent, value, "AuditEvent");
}
