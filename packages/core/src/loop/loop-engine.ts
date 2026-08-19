import type {
  AuditReasonCode,
  LoopCycle,
  LoopDefinition,
  LoopName,
  LoopOutput,
  LoopState,
} from "@agenttrading/contracts";
import type { AuditLog } from "../stategraph/audit-log.ts";
import { runLoop, type LoopWork } from "./loop-runner.ts";

/**
 * LoopEngine: the deterministic orchestrator for Beta.1 Loop Engineering
 * (Issue #24). Composes all 8 loops into a closed cycle, records every
 * loop output to audit, and safely halts a loop when its stopping criterion
 * is met.
 *
 * The engine does not enforce wall-clock timing; that belongs to the runtime.
 * It only defines the contracts, runs one cycle at a time, and maintains
 * per-loop state across iterations.
 */

/** Constructor options for the LoopEngine. */
export interface LoopEngineOptions {
  /** The ordered loop definitions composing the closed cycle. */
  loops: readonly LoopDefinition[];
  /** The audit log for recording every loop output. */
  audit: AuditLog;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

/**
 * Default loop definitions for the 8 canonical loops (Beta.1, Issue #24).
 *
 * Each loop has explicit frequency, inputs, outputs, permissions, and a
 * stopping criterion. The loops compose into the full closed cycle:
 *
 *   data → graph → alpha → debate → risk → execution → reconciliation → audit
 *
 * with the audit loop also observing the entire cycle.
 */
export function defaultLoopDefinitions(): readonly LoopDefinition[] {
  return [
    {
      name: "data",
      description:
        "Ingests and normalizes market data from CEX and DEX connectors.",
      frequencyMs: 1_000,
      inputKeys: ["rawMarketData"],
      outputKeys: ["normalizedMarketData", "dataQualityReport"],
      requiredPermissions: ["OBSERVE_MARKET_DATA"],
      stoppingCriterion: {
        type: "data-quality",
        reason: "All data sources are disconnected or stale",
        reasonCode: "RECONCILIATION_OK",
        evaluate: (ctx) => {
          const disconnected = ctx.disconnectedSources as number | undefined;
          const total = ctx.totalSources as number | undefined;
          return (
            typeof disconnected === "number" &&
            typeof total === "number" &&
            disconnected >= total &&
            total > 0
          );
        },
      },
    },
    {
      name: "graph",
      description: "Updates the MarketGraph from normalized market data.",
      frequencyMs: 2_000,
      inputKeys: ["normalizedMarketData"],
      outputKeys: ["graphSnapshot"],
      requiredPermissions: ["OBSERVE_MARKET_DATA", "OBSERVE_STATE"],
      stoppingCriterion: {
        type: "graph-stale",
        reason: "Graph has not been updated within the staleness threshold",
        reasonCode: "RECONCILIATION_OK",
        evaluate: (ctx) => {
          const stale = ctx.graphStale as boolean | undefined;
          return stale === true;
        },
      },
    },
    {
      name: "alpha",
      description:
        "Detects arbitrage and trading opportunities from the market graph.",
      frequencyMs: 5_000,
      inputKeys: ["graphSnapshot"],
      outputKeys: ["opportunityCandidates"],
      requiredPermissions: ["OBSERVE_MARKET_DATA", "OBSERVE_STATE", "PROPOSE_SIGNAL"],
      stoppingCriterion: {
        type: "no-opportunity",
        reason: "No opportunities detected for the configured retention window",
        reasonCode: "OPPORTUNITY_RECORDED",
        evaluate: (ctx) => {
          const count = ctx.opportunityCount as number | undefined;
          return typeof count === "number" && count === 0;
        },
      },
    },
    {
      name: "debate",
      description:
        "Agent review of opportunity candidates: Bull, Bear, and Skeptic.",
      frequencyMs: 5_000,
      inputKeys: ["opportunityCandidates"],
      outputKeys: ["reviewedCandidates"],
      requiredPermissions: ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
      stoppingCriterion: {
        type: "max-iterations",
        reason: "Agent review exceeded the maximum debate rounds",
        reasonCode: "TRANSITION_BLOCKED",
        evaluate: (ctx) => {
          const rounds = ctx.debateRounds as number | undefined;
          const maxRounds = ctx.maxDebateRounds as number | undefined;
          return (
            typeof rounds === "number" &&
            typeof maxRounds === "number" &&
            rounds >= maxRounds
          );
        },
      },
    },
    {
      name: "risk",
      description:
        "Risk Engine evaluates OrderIntents against all risk limits.",
      frequencyMs: 5_000,
      inputKeys: ["reviewedCandidates", "orderIntents"],
      outputKeys: ["riskDecisions"],
      requiredPermissions: ["APPROVE_RISK", "OBSERVE_STATE"],
      stoppingCriterion: {
        type: "risk-exceeded",
        reason: "Daily loss limit or exposure limit breached",
        reasonCode: "TRANSITION_BLOCKED",
        evaluate: (ctx) => {
          const breached = ctx.riskLimitBreached as boolean | undefined;
          return breached === true;
        },
      },
    },
    {
      name: "execution",
      description:
        "Execution Engine submits approved orders (paper mode in Beta).",
      frequencyMs: 10_000,
      inputKeys: ["riskDecisions"],
      outputKeys: ["executionResults"],
      requiredPermissions: ["SUBMIT_ORDER", "OBSERVE_STATE"],
      stoppingCriterion: {
        type: "execution-failed",
        reason: "Too many consecutive execution failures",
        reasonCode: "TRANSITION_BLOCKED",
        evaluate: (ctx) => {
          const failures = ctx.consecutiveFailures as number | undefined;
          const maxFailures = ctx.maxConsecutiveFailures as number | undefined;
          return (
            typeof failures === "number" &&
            typeof maxFailures === "number" &&
            failures >= maxFailures
          );
        },
      },
    },
    {
      name: "reconciliation",
      description:
        "Compares internal state against external exchange/chain state.",
      frequencyMs: 30_000,
      inputKeys: ["executionResults"],
      outputKeys: ["reconciliationStatus"],
      requiredPermissions: ["OBSERVE_STATE", "OBSERVE_AUDIT"],
      stoppingCriterion: {
        type: "reconciliation-mismatch",
        reason: "Internal state diverges from external state beyond tolerance",
        reasonCode: "RECONCILIATION_OK",
        evaluate: (ctx) => {
          const mismatch = ctx.reconciliationMismatch as boolean | undefined;
          return mismatch === true;
        },
      },
    },
    {
      name: "audit",
      description:
        "Records all loop outputs and decisions for full traceability.",
      frequencyMs: 1_000,
      inputKeys: [
        "normalizedMarketData",
        "graphSnapshot",
        "opportunityCandidates",
        "reviewedCandidates",
        "riskDecisions",
        "executionResults",
        "reconciliationStatus",
      ],
      outputKeys: ["auditSummary"],
      requiredPermissions: ["OBSERVE_AUDIT", "OBSERVE_STATE"],
      stoppingCriterion: {
        type: "custom",
        reason: "Audit log storage capacity exhausted",
        reasonCode: "TRANSITION_BLOCKED",
        evaluate: (ctx) => {
          const capacity = ctx.auditCapacityExhausted as boolean | undefined;
          return capacity === true;
        },
      },
    },
  ];
}

/**
 * The ordered canonical loop names composing the closed cycle.
 */
export const CANONICAL_LOOP_ORDER: readonly LoopName[] = [
  "data",
  "graph",
  "alpha",
  "debate",
  "risk",
  "execution",
  "reconciliation",
  "audit",
];

/** Initial state for a loop that has not yet run. */
function initialLoopState(name: LoopName): LoopState {
  return {
    name,
    lastRunAtMs: 0,
    runCount: 0,
    stopped: false,
  };
}

/** Maps loop names to their definitions for O(1) lookup. */
function buildLoopMap(
  loops: readonly LoopDefinition[],
): ReadonlyMap<LoopName, LoopDefinition> {
  return new Map(loops.map((loop) => [loop.name, loop]));
}

/**
 * LoopEngine: orchestrates all 8 loops into a closed cycle.
 *
 * Usage:
 * ```ts
 * const engine = new LoopEngine({ loops: defaultLoopDefinitions(), audit });
 * const cycle = engine.runCycle({ timestampMs: Date.now(), inputs: {} });
 * ```
 */
export class LoopEngine {
  private readonly loopMap: ReadonlyMap<LoopName, LoopDefinition>;
  private readonly audit: AuditLog;
  private readonly now: () => number;
  private readonly states: Map<LoopName, LoopState>;
  private cycleCounter = 0;

  constructor(options: LoopEngineOptions) {
    this.loopMap = buildLoopMap(options.loops);
    this.audit = options.audit;
    this.now = options.now ?? (() => Date.now());
    this.states = new Map(
      options.loops.map((loop) => [loop.name, initialLoopState(loop.name)]),
    );
  }

  /** Current state of a specific loop. */
  loopState(name: LoopName): LoopState {
    return { ...this.states.get(name)! };
  }

  /** All loop states. */
  allLoopStates(): ReadonlyMap<LoopName, LoopState> {
    return new Map(
      [...this.states.entries()].map(([name, state]) => [name, { ...state }]),
    );
  }

  /**
   * Run one complete cycle through all 8 loops in canonical order.
   *
   * Each loop's output is recorded to the audit log. If a loop hits its
   * stopping criterion, the cycle halts that loop and returns early with
   * `completed: false`.
   *
   * @param options.systemInputs  - Shared system inputs available to all loops
   * @param options.loopWork      - Per-loop work functions; loops without a
   *                                work function use a no-op that produces no
   *                                outputs.
   * @param options.timestampMs   - Timestamp for this cycle.
   * @returns The completed LoopCycle with all outputs recorded.
   */
  runCycle(options: {
    systemInputs?: Record<string, unknown>;
    loopWork?: Partial<Record<LoopName, LoopWork>>;
    timestampMs: number;
  }): LoopCycle {
    const {
      systemInputs = {},
      loopWork = {},
      timestampMs,
    } = options;

    const cycleId = `cycle-${++this.cycleCounter}-${timestampMs}`;
    const loopOutputs: LoopOutput[] = [];
    let completed = true;
    let haltedLoop: LoopName | undefined;
    let haltedReason: string | undefined;

    // Build the running context: each loop's outputs become available to
    // downstream loops, plus the system inputs.
    const runningContext: Record<string, unknown> = { ...systemInputs };

    for (const loopName of CANONICAL_LOOP_ORDER) {
      const definition = this.loopMap.get(loopName)!;
      const state = this.states.get(loopName)!;

      // Skip loops that have already been halted by a previous cycle.
      if (state.stopped) {
        completed = false;
        haltedLoop = loopName;
        haltedReason = state.stoppedReason;
        break;
      }

      // Run the loop.
      const result = runLoop({
        definition,
        state,
        work: loopWork[loopName] ?? (() => undefined),
        audit: this.audit,
        timestampMs,
        context: runningContext,
      });

      // Update state.
      this.states.set(loopName, result.state);

      if (result.stopped) {
        loopOutputs.push(
          result.output ?? {
            loopName,
            timestampMs,
            outputs: {},
            metadata: { halted: true, reason: result.stoppedReason },
          },
        );
        completed = false;
        haltedLoop = loopName;
        haltedReason = result.stoppedReason;
        break;
      }

      if (result.output !== undefined) {
        loopOutputs.push(result.output);
        // Merge outputs into the running context for downstream loops.
        Object.assign(runningContext, result.output.outputs);
      }
    }

    const cycle: LoopCycle = {
      cycleId,
      loopOutputs,
      startedAtMs: timestampMs,
      completedAtMs: timestampMs,
      completed,
      haltedLoop,
      haltedReason,
    };

    // Record the cycle summary to audit.
    this.audit.record({
      eventId: `cycle-${cycleId}`,
      timestampMs,
      action: "STATE_TRANSITION",
      actor: "loop-engine",
      state: "IDLE",
      reasonCodes: completed
        ? ["TRANSITION_ALLOWED", "CYCLE_COMPLETE"]
        : ["TRANSITION_BLOCKED", "LOOP_STOPPED"],
      data: {
        cycleId,
        completed,
        haltedLoop,
        haltedReason,
        loopCount: loopOutputs.length,
        loopNames: loopOutputs.map((o) => o.loopName),
      },
    });

    return cycle;
  }
}
