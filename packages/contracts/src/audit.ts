import {
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
  "SYSTEM_MODE_CHANGE",
  "DATA_QUALITY_UPDATE",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

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
}

const isAuditAction: Validator<AuditAction> = isEnumOf(AUDIT_ACTIONS);

export const isAuditEvent: Validator<AuditEvent> = isObjectOf({
  eventId: isString,
  sequence: isNumber,
  timestampMs: isNumber,
  action: isAuditAction,
  actor: isString,
  state: isOptional(isStateName),
  data: isOptional(isFreeformRecord),
});

export function parseAuditEvent(value: unknown): AuditEvent {
  return parse(isAuditEvent, value, "AuditEvent");
}
