import type {
  AuditReasonCode,
  LoopDefinition,
  LoopOutput,
  LoopState,
} from "@agenttrading/contracts";
import type { AuditLog, AuditRecordInput } from "@agenttrading/core-stategraph";

/**
 * The work a loop performs on each iteration. Returns the loop's typed output
 * payload (keyed by the loop's declared output keys), or undefined when the
 * loop has nothing to produce this iteration.
 */
export type LoopWork = (
  context: Record<string, unknown>,
) => Record<string, unknown> | undefined;

/** Result of running a single loop iteration. */
export interface LoopRunResult {
  /** The output produced by the loop, if any. */
  output?: LoopOutput;
  /** Whether the loop hit its stopping criterion and halted. */
  stopped: boolean;
  /** Reason the loop stopped, if stopped. */
  stoppedReason?: string;
  /** Audit reason codes attached to this run's audit event. */
  reasonCodes: readonly AuditReasonCode[];
  /** The updated loop state after this run. */
  state: LoopState;
}

/**
 * Runs a single iteration of a loop: evaluates the stopping criterion, runs
 * the work function, records an audit event, and returns the result.
 *
 * This function does NOT mutate the loop state; the caller (LoopEngine) is
 * responsible for maintaining state across iterations.
 */
export function runLoop(options: {
  definition: LoopDefinition;
  state: LoopState;
  work: LoopWork;
  audit: AuditLog;
  timestampMs: number;
  context?: Record<string, unknown>;
}): LoopRunResult {
  const { definition, state, work, audit, timestampMs, context = {} } = options;

  // 1. Evaluate stopping criterion.
  const shouldStop = definition.stoppingCriterion.evaluate(context);
  if (shouldStop) {
    const reasonCodes: AuditReasonCode[] = [
      "LOOP_STOPPED",
      definition.stoppingCriterion.reasonCode,
    ];
    const eventInput: AuditRecordInput = {
      eventId: `loop-${definition.name}-stopped-${timestampMs}`,
      timestampMs,
      action: "STATE_TRANSITION",
      actor: `loop-${definition.name}`,
      state: "IDLE",
      reasonCodes,
      data: {
        loopName: definition.name,
        stoppingCriterionType: definition.stoppingCriterion.type,
        stoppedReason: definition.stoppingCriterion.reason,
        runCount: state.runCount,
      },
    };
    audit.record(eventInput);
    return {
      stopped: true,
      stoppedReason: definition.stoppingCriterion.reason,
      reasonCodes,
      state: {
        ...state,
        stopped: true,
        stoppedAtMs: timestampMs,
        stoppedReason: definition.stoppingCriterion.reason,
      },
    };
  }

  // 2. Run the loop's work function.
  const outputs = work(context);

  // 3. Build the output.
  const loopOutput: LoopOutput = {
    loopName: definition.name,
    timestampMs,
    outputs: outputs ?? {},
    metadata: {
      iteration: state.runCount + 1,
      frequencyMs: definition.frequencyMs,
    },
  };

  // 4. Record audit event.
  const reasonCodes: AuditReasonCode[] = ["TRANSITION_ALLOWED"];
  const eventInput: AuditRecordInput = {
    eventId: `loop-${definition.name}-output-${timestampMs}`,
    timestampMs,
    action: "STATE_TRANSITION",
    actor: `loop-${definition.name}`,
    state: "IDLE",
    reasonCodes,
    data: {
      loopName: definition.name,
      outputKeys: definition.outputKeys,
      iteration: state.runCount + 1,
      outputs,
    },
  };
  audit.record(eventInput);

  return {
    output: loopOutput,
    stopped: false,
    reasonCodes,
    state: {
      name: definition.name,
      lastRunAtMs: timestampMs,
      runCount: state.runCount + 1,
      stopped: false,
    },
  };
}
