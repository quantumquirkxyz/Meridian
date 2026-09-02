import {
  isArrayOf,
  isBoolean,
  isEnumOf,
  isFreeformRecord,
  isNumber,
  isObjectOf,
  isOptional,
  isString,
  parse,
  type Validator,
} from "./schema.ts";
import { isPermission, type Permission } from "./stategraph.ts";
import { isAuditReasonCode, type AuditReasonCode } from "./audit.ts";

/**
 * Loop Engineering contracts (Issue #24).
 *
 * A Loop is a closed perception → decision → action → learning cycle with
 * explicit frequency, inputs, outputs, permissions, and stopping criteria.
 * Every decision maps to a loop with a contract, and every output is recorded.
 */

/** The eight canonical loop names. */
export const LOOP_NAMES = [
  "data",
  "graph",
  "alpha",
  "debate",
  "risk",
  "execution",
  "reconciliation",
  "audit",
] as const;

export type LoopName = (typeof LOOP_NAMES)[number];

/** Type of stopping criterion evaluated each iteration. */
export const STOPPING_CRITERION_TYPES = [
  "data-quality",
  "graph-stale",
  "no-opportunity",
  "risk-exceeded",
  "execution-failed",
  "reconciliation-mismatch",
  "max-iterations",
  "custom",
] as const;

export type StoppingCriterionType = (typeof STOPPING_CRITERION_TYPES)[number];

/**
 * A stopping criterion for a loop. When `evaluate` returns true, the loop
 * halts its own stage safely (acceptance criterion 2: "A loop that hits a
 * stopping criterion halts its own stage safely").
 */
export interface StoppingCriterion {
  /** Machine-readable type for observability and audit. */
  type: StoppingCriterionType;
  /** Human-readable reason when this criterion triggers. */
  reason: string;
  /** Audit reason code attached to the halt event. */
  reasonCode: AuditReasonCode;
  /**
   * Evaluate whether the loop should halt. The `context` is a typed record
   * of whatever state the loop's runner provides (data quality scores,
   * graph staleness, iteration count, etc.). Returns true when the criterion
   * is met and the loop should stop.
   */
  evaluate: (context: Record<string, unknown>) => boolean;
}

/**
 * The typed output of one loop iteration. Each loop declares which concrete
 * keys it produces, so downstream loops can consume them.
 */
export interface LoopOutput {
  /** The loop that produced this output. */
  loopName: LoopName;
  /** Timestamp of this iteration. */
  timestampMs: number;
  /** Typed output payload keyed by the loop's declared output keys. */
  outputs: Record<string, unknown>;
  /** Optional metadata for audit (iteration number, duration, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * A loop definition specifies the contract for one loop in the closed cycle.
 */
export interface LoopDefinition {
  /** Canonical name. */
  name: LoopName;
  /** Human-readable description. */
  description: string;
  /**
   * Expected iteration interval in milliseconds. The engine does not enforce
   * wall-clock timing (that belongs in the runtime); this is the contract's
   * declared frequency for observability and audit.
   */
  frequencyMs: number;
  /** Input keys this loop expects from upstream loops or the system. */
  inputKeys: readonly string[];
  /** Output keys this loop produces for downstream loops. */
  outputKeys: readonly string[];
  /** Permissions the loop requires to execute. */
  requiredPermissions: readonly Permission[];
  /** The loop's stopping criterion. When it evaluates to true, the loop halts. */
  stoppingCriterion: StoppingCriterion;
}

/** Runtime state of a loop, tracked by the engine. */
export interface LoopState {
  /** The loop this state tracks. */
  name: LoopName;
  /** Timestamp of the most recent successful iteration. */
  lastRunAtMs: number;
  /** Total number of completed iterations. */
  runCount: number;
  /** Whether the loop has hit its stopping criterion and is halted. */
  stopped: boolean;
  /** Timestamp when the loop was halted (undefined if still running). */
  stoppedAtMs?: number;
  /** Reason the loop was halted (undefined if still running). */
  stoppedReason?: string;
}

/**
 * A complete cycle: all 8 loops executed in order, producing a recorded
 * output for each. The cycle is the fundamental unit of closed-loop
 * operation (acceptance criterion 4: "Loops compose into the full closed
 * cycle").
 */
export interface LoopCycle {
  /** Unique cycle identifier for idempotency. */
  cycleId: string;
  /** Ordered outputs from each loop in the cycle. */
  loopOutputs: readonly LoopOutput[];
  /** Timestamp when the cycle started. */
  startedAtMs: number;
  /** Timestamp when the cycle completed (or was halted). */
  completedAtMs: number;
  /** Whether all loops completed without hitting a stopping criterion. */
  completed: boolean;
  /** The loop that halted, if any. */
  haltedLoop?: LoopName;
  /** The reason the cycle was halted, if any. */
  haltedReason?: string;
}

// ── Validators ──────────────────────────────────────────────────────────

const isLoopName: Validator<LoopName> = isEnumOf(LOOP_NAMES);
const isStoppingCriterionType: Validator<StoppingCriterionType> = isEnumOf(
  STOPPING_CRITERION_TYPES,
);

const isStoppingCriterion: Validator<StoppingCriterion> = isObjectOf({
  type: isStoppingCriterionType,
  reason: isString,
  reasonCode: isAuditReasonCode,
  evaluate: (value): value is StoppingCriterion["evaluate"] =>
    typeof value === "function",
});

const isLoopDefinitionShape: Validator<LoopDefinition> = isObjectOf({
  name: isLoopName,
  description: isString,
  frequencyMs: isNumber,
  inputKeys: isArrayOf(isString),
  outputKeys: isArrayOf(isString),
  requiredPermissions: isArrayOf(isPermission),
  stoppingCriterion: isStoppingCriterion,
});

export const isLoopDefinition: Validator<LoopDefinition> = isLoopDefinitionShape;

const isLoopOutput: Validator<LoopOutput> = isObjectOf({
  loopName: isLoopName,
  timestampMs: isNumber,
  outputs: isFreeformRecord,
  metadata: isOptional(isFreeformRecord),
});

export { isLoopOutput };

const isLoopState: Validator<LoopState> = isObjectOf({
  name: isLoopName,
  lastRunAtMs: isNumber,
  runCount: isNumber,
  stopped: isBoolean,
  stoppedAtMs: isOptional(isNumber),
  stoppedReason: isOptional(isString),
});

export { isLoopState };

const isLoopCycle: Validator<LoopCycle> = isObjectOf({
  cycleId: isString,
  loopOutputs: isArrayOf(isLoopOutput),
  startedAtMs: isNumber,
  completedAtMs: isNumber,
  completed: isBoolean,
  haltedLoop: isOptional(isLoopName),
  haltedReason: isOptional(isString),
});

export { isLoopCycle };

export function parseLoopDefinition(value: unknown): LoopDefinition {
  return parse(isLoopDefinition, value, "LoopDefinition");
}

export function parseLoopOutput(value: unknown): LoopOutput {
  return parse(isLoopOutput, value, "LoopOutput");
}

export function parseLoopState(value: unknown): LoopState {
  return parse(isLoopState, value, "LoopState");
}

export function parseLoopCycle(value: unknown): LoopCycle {
  return parse(isLoopCycle, value, "LoopCycle");
}
