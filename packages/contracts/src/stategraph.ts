import {
  isArrayOf,
  isBoolean,
  isBooleanLiteralFalse,
  isBooleanLiteralTrue,
  isEnumOf,
  isNumber,
  isObjectOf,
  isOptional,
  isRecordOf,
  isString,
  isOneOf,
  isUnknown,
  type Validator,
} from "./schema.ts";
import { isSystemMode, type SystemMode } from "./modes.ts";
import { isRiskReasonCode, type RiskReasonCode } from "./reason-codes.ts";

/**
 * StateGraph base contracts (ADR-0002, ARCHITECTURE.md). The project's own
 * minimal deterministic orchestrator: state machine + guard conditions +
 * typed handoffs + permissions + per-transition audit.
 */

export const STATE_NAMES = [
  "IDLE",
  "INGEST_MARKET_DATA",
  "NORMALIZE_MARKET_STATE",
  "UPDATE_MARKET_GRAPH",
  "DETECT_OPPORTUNITY",
  "BUILD_ORDER_INTENT",
  "REQUEST_AGENT_REVIEW",
  "RISK_VALIDATE",
  "EXECUTION_PRECHECK",
  "EXECUTE_ORDER",
  "RECONCILE",
  "AUDIT_DECISION",
  "LEARN_FROM_OUTCOME",
  "HALT",
  "DEGRADED_MODE",
  "CASH_ONLY_MODE",
  "CANCEL_ONLY_MODE",
  "REDUCE_ONLY_MODE",
] as const;

export type StateName = (typeof STATE_NAMES)[number];

/** Structured context passed through every transition. */
export interface StateContext {
  state: StateName;
  mode: SystemMode;
  updatedAtMs: number;
  /** Arbitrary typed handoff data. */
  data?: Record<string, unknown>;
}

/** A node in the state graph. */
export interface StateNode {
  name: StateName;
  description?: string;
  allowed: boolean;
  /** Permissions required to enter/operate in this state. */
  permissions: Permission[];
}

export type GuardResult =
  | { ok: true; reason?: string }
  | { ok: false; reason: string; reasonCodes: RiskReasonCode[] };

/** Evaluates whether a transition is allowed in the given context. */
export interface TransitionGuard {
  name: string;
  evaluate(context: StateContext): GuardResult;
}

/** A directed transition between two states. */
export interface Transition {
  id: string;
  from: StateName;
  to: StateName;
  guard: TransitionGuard;
  requiredPermissions: Permission[];
  /** Mandatory audit: every transition is audited (ARCHITECTURE.md:41). */
  audit: true;
}

/**
 * Permission model (ADR-0003, ARCHITECTURE.md). Agents never receive the
 * execution-authority permissions below.
 */
export const PERMISSIONS = [
  "OBSERVE_MARKET_DATA",
  "OBSERVE_STATE",
  "OBSERVE_AUDIT",
  "PROPOSE_SIGNAL",
  "PROPOSE_EXECUTION_PLAN",
  "PROPOSE_RISK_REVIEW",
  "REQUEST_MORE_DATA",
  "TRIGGER_DEGRADED_MODE",
  "TRIGGER_CANCEL_ONLY",
  "APPROVE_RISK",
  "SUBMIT_ORDER",
  "CANCEL_ORDER",
  "SIGN_TRANSACTION",
  "MOVE_FUNDS",
  "MODIFY_RISK_LIMITS",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** ARCHITECTURE.md: never granted to agents. */
export const PERMISSIONS_NEVER_GRANTED_TO_AGENTS = [
  "APPROVE_RISK",
  "SUBMIT_ORDER",
  "SIGN_TRANSACTION",
  "MOVE_FUNDS",
  "MODIFY_RISK_LIMITS",
] as const satisfies readonly Permission[];

/** AgentReview: the typed recommendation agents produce at REQUEST_AGENT_REVIEW. */
export const AGENT_REVIEW_ACTIONS = [
  "APPROVE",
  "REJECT",
  "REQUEST_MORE_DATA",
  "ABSTAIN",
] as const;

export type AgentReviewAction = (typeof AGENT_REVIEW_ACTIONS)[number];

export interface AgentReview {
  agent: string;
  action: AgentReviewAction;
  comment: string;
  reviewedAtMs: number;
}

export const isStateName: Validator<StateName> = isEnumOf(STATE_NAMES);
export const isPermission: Validator<Permission> = isEnumOf(PERMISSIONS);
const isAgentReviewAction: Validator<AgentReviewAction> =
  isEnumOf(AGENT_REVIEW_ACTIONS);

export const isStateContext: Validator<StateContext> = isObjectOf({
  state: isStateName,
  mode: isSystemMode,
  updatedAtMs: isNumber,
  data: isOptional(isRecordOf(isUnknown)),
});

export const isStateNode: Validator<StateNode> = isObjectOf({
  name: isStateName,
  description: isOptional(isString),
  allowed: isBoolean,
  permissions: isArrayOf(isPermission),
});

export const isGuardResult: Validator<GuardResult> = isOneOf<GuardResult>([
  isObjectOf({
    ok: isBooleanLiteralTrue,
    reason: isOptional(isString),
  }),
  isObjectOf({
    ok: isBooleanLiteralFalse,
    reason: isString,
    reasonCodes: isArrayOf(isRiskReasonCode),
  }),
]);

export const isTransitionGuard: Validator<TransitionGuard> = isObjectOf<
  TransitionGuard
>({
  name: isString,
  evaluate: (value): value is TransitionGuard["evaluate"] =>
    typeof value === "function",
});

export const isTransition: Validator<Transition> = isObjectOf({
  id: isString,
  from: isStateName,
  to: isStateName,
  guard: isTransitionGuard,
  requiredPermissions: isArrayOf(isPermission),
  audit: isBooleanLiteralTrue,
});

export const isAgentReview: Validator<AgentReview> = isObjectOf({
  agent: isString,
  action: isAgentReviewAction,
  comment: isString,
  reviewedAtMs: isNumber,
});
