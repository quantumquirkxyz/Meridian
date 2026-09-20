import { describe, expect, test } from "bun:test";
import {
  isAuditEvent,
  isLoopCycle,
  isLoopDefinition,
  isLoopOutput,
  isLoopState,
  LOOP_NAMES,
  type LoopDefinition,
  type LoopName,
  type LoopOutput,
  type LoopState,
} from "@agenttrading/contracts";
import { AuditLog } from "../src/stategraph/state-graph.ts";
import {
  CANONICAL_LOOP_ORDER,
  defaultLoopDefinitions,
  LoopEngine,
} from "../src/loop/loop-engine.ts";
import { runLoop } from "../src/loop/loop-runner.ts";
import { ReconciliationEngine } from "../src/reconciliation/reconciliation-engine.ts";

const FIXED_TS = 1_700_000_000_000;

/** Creates a fresh AuditLog for testing. */
function newAudit(): AuditLog {
  return new AuditLog();
}

// ── Contract validation ─────────────────────────────────────────────────

describe("Loop contracts are valid (issue #24)", () => {
  test("all 8 loop names are defined", () => {
    expect(LOOP_NAMES).toHaveLength(8);
    expect(LOOP_NAMES).toContain("data");
    expect(LOOP_NAMES).toContain("graph");
    expect(LOOP_NAMES).toContain("alpha");
    expect(LOOP_NAMES).toContain("debate");
    expect(LOOP_NAMES).toContain("risk");
    expect(LOOP_NAMES).toContain("execution");
    expect(LOOP_NAMES).toContain("reconciliation");
    expect(LOOP_NAMES).toContain("audit");
  });

  test("default loop definitions pass contract validation", () => {
    const definitions = defaultLoopDefinitions();
    expect(definitions).toHaveLength(8);
    for (const def of definitions) {
      expect(isLoopDefinition(def), `invalid definition for ${def.name}`).toBe(
        true,
      );
    }
  });

  test("every loop has explicit frequency, inputs, outputs, and stopping criteria", () => {
    const definitions = defaultLoopDefinitions();
    for (const def of definitions) {
      expect(def.frequencyMs).toBeGreaterThan(0);
      expect(def.inputKeys.length).toBeGreaterThan(0);
      expect(def.outputKeys.length).toBeGreaterThan(0);
      expect(def.stoppingCriterion).toBeDefined();
      expect(def.stoppingCriterion.type).toBeTruthy();
      expect(def.stoppingCriterion.reason).toBeTruthy();
      expect(typeof def.stoppingCriterion.evaluate).toBe("function");
    }
  });

  test("CANONICAL_LOOP_ORDER includes all 8 loops exactly once", () => {
    expect(CANONICAL_LOOP_ORDER).toHaveLength(8);
    const unique = new Set(CANONICAL_LOOP_ORDER);
    expect(unique.size).toBe(8);
    for (const name of LOOP_NAMES) {
      expect(CANONICAL_LOOP_ORDER).toContain(name);
    }
  });
});

// ── Loop runner ─────────────────────────────────────────────────────────

describe("Loop runner executes one iteration", () => {
  test("runs a loop and produces an output", () => {
    const audit = newAudit();
    const definition: LoopDefinition = {
      name: "data",
      description: "test loop",
      frequencyMs: 1_000,
      inputKeys: ["raw"],
      outputKeys: ["normalized"],
      requiredPermissions: ["OBSERVE_MARKET_DATA"],
      stoppingCriterion: {
        type: "custom",
        reason: "test",
        reasonCode: "TRANSITION_BLOCKED",
        evaluate: () => false,
      },
    };
    const state: LoopState = {
      name: "data",
      lastRunAtMs: 0,
      runCount: 0,
      stopped: false,
    };

    const result = runLoop({
      definition,
      state,
      work: () => ({ normalized: "test-data" }),
      audit,
      timestampMs: FIXED_TS,
    });

    expect(result.stopped).toBe(false);
    expect(result.output).toBeDefined();
    expect(result.output?.loopName).toBe("data");
    expect(result.output?.outputs).toEqual({ normalized: "test-data" });
    expect(result.state.runCount).toBe(1);
    expect(result.state.lastRunAtMs).toBe(FIXED_TS);
    expect(isLoopOutput(result.output!)).toBe(true);
  });

  test("records an audit event for the loop output", () => {
    const audit = newAudit();
    const definition: LoopDefinition = {
      name: "graph",
      description: "test loop",
      frequencyMs: 2_000,
      inputKeys: ["data"],
      outputKeys: ["snapshot"],
      requiredPermissions: ["OBSERVE_MARKET_DATA"],
      stoppingCriterion: {
        type: "custom",
        reason: "test",
        reasonCode: "TRANSITION_BLOCKED",
        evaluate: () => false,
      },
    };
    const state: LoopState = {
      name: "graph",
      lastRunAtMs: 0,
      runCount: 0,
      stopped: false,
    };

    runLoop({
      definition,
      state,
      work: () => ({ snapshot: { version: 1 } }),
      audit,
      timestampMs: FIXED_TS,
    });

    const events = audit.all();
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("STATE_TRANSITION");
    expect(events[0].actor).toBe("loop-graph");
    expect(events[0].reasonCodes).toContain("TRANSITION_ALLOWED");
    expect(isAuditEvent(events[0])).toBe(true);
  });

  test("halts safely when stopping criterion is met", () => {
    const audit = newAudit();
    const definition: LoopDefinition = {
      name: "data",
      description: "test loop",
      frequencyMs: 1_000,
      inputKeys: [],
      outputKeys: ["out"],
      requiredPermissions: ["OBSERVE_MARKET_DATA"],
      stoppingCriterion: {
        type: "data-quality",
        reason: "All sources disconnected",
        reasonCode: "RECONCILIATION_OK",
        evaluate: (ctx) => {
          return (
            (ctx.disconnectedSources as number) >=
            (ctx.totalSources as number)
          );
        },
      },
    };
    const state: LoopState = {
      name: "data",
      lastRunAtMs: 0,
      runCount: 0,
      stopped: false,
    };

    const result = runLoop({
      definition,
      state,
      work: () => ({ out: "should not run" }),
      audit,
      timestampMs: FIXED_TS,
      context: { disconnectedSources: 2, totalSources: 2 },
    });

    expect(result.stopped).toBe(true);
    expect(result.stoppedReason).toBe("All sources disconnected");
    expect(result.output).toBeUndefined();
    expect(result.state.stopped).toBe(true);
    expect(result.state.stoppedAtMs).toBe(FIXED_TS);
    expect(result.state.stoppedReason).toBe("All sources disconnected");

    // Audit event is still recorded for the halt.
    const events = audit.all();
    expect(events.length).toBe(1);
    expect(events[0].reasonCodes).toContain("RECONCILIATION_OK");
  });

  test("no work function produces empty outputs", () => {
    const audit = newAudit();
    const definition: LoopDefinition = {
      name: "alpha",
      description: "test loop",
      frequencyMs: 5_000,
      inputKeys: ["graph"],
      outputKeys: ["candidates"],
      requiredPermissions: ["PROPOSE_SIGNAL"],
      stoppingCriterion: {
        type: "custom",
        reason: "test",
        reasonCode: "TRANSITION_BLOCKED",
        evaluate: () => false,
      },
    };
    const state: LoopState = {
      name: "alpha",
      lastRunAtMs: 0,
      runCount: 0,
      stopped: false,
    };

    const result = runLoop({
      definition,
      state,
      work: () => undefined,
      audit,
      timestampMs: FIXED_TS,
    });

    expect(result.stopped).toBe(false);
    expect(result.output).toBeDefined();
    expect(result.output?.outputs).toEqual({});
  });
});

// ── Loop engine: full cycle ─────────────────────────────────────────────

describe("LoopEngine composes all 8 loops into a closed cycle (AC4)", () => {
  test("runs a complete cycle with all 8 loops", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
      reconciliationEngine: new ReconciliationEngine(),
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: {
        rawMarketData: { test: true },
        reconciliationInternal: {
          orders: [],
          fills: [],
          positions: [],
          balances: [],
        },
        reconciliationExternal: {
          orders: [],
          fills: [],
          positions: [],
          balances: [],
        },
      },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 }, dataQualityReport: { score: 0.9 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
        alpha: () => ({ opportunityCandidates: [{ id: "opp-1" }] }),
        debate: () => ({ reviewedCandidates: [{ id: "opp-1", reviewed: true }] }),
        risk: () => ({ riskDecisions: [{ decision: "APPROVE" }] }),
        execution: () => ({ executionResults: [{ filled: true }] }),
        audit: () => ({ auditSummary: { totalEvents: 8 } }),
      },
    });

    expect(cycle.completed).toBe(true);
    expect(cycle.haltedLoop).toBeUndefined();
    expect(cycle.haltedReason).toBeUndefined();
    expect(cycle.loopOutputs).toHaveLength(8);
    expect(isLoopCycle(cycle)).toBe(true);

    // Verify each loop produced an output.
    const loopNames = cycle.loopOutputs.map((o) => o.loopName);
    for (const name of LOOP_NAMES) {
      expect(loopNames).toContain(name);
    }
  });

  test("every loop output is recorded to audit (AC3: auditable)", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
      reconciliationEngine: new ReconciliationEngine(),
    });

    engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: {
        reconciliationInternal: {
          orders: [],
          fills: [],
          positions: [],
          balances: [],
        },
        reconciliationExternal: {
          orders: [],
          fills: [],
          positions: [],
          balances: [],
        },
      },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
        alpha: () => ({ opportunityCandidates: [] }),
        debate: () => ({ reviewedCandidates: [] }),
        risk: () => ({ riskDecisions: [] }),
        execution: () => ({ executionResults: [] }),
        audit: () => ({ auditSummary: {} }),
      },
    });

    // 8 loop output events + 1 cycle summary event.
    const events = audit.all();
    expect(events.length).toBe(9);

    // Verify loop output events (8 loops each with actor starting with "loop-").
    // The cycle summary has actor "loop-engine" which also starts with "loop-",
    // so filter explicitly: 8 loop events + 1 cycle summary = 9 total.
    const loopEvents = events.filter(
      (e) => e.actor.startsWith("loop-") && e.actor !== "loop-engine",
    );
    expect(loopEvents.length).toBe(8);

    for (const event of loopEvents) {
      expect(isAuditEvent(event)).toBe(true);
      expect(event.action).toBe("STATE_TRANSITION");
      expect(event.reasonCodes).toContain("TRANSITION_ALLOWED");
      expect(event.data).toBeDefined();
      expect((event.data as Record<string, unknown>).loopName).toBeDefined();
    }

    // Verify cycle summary event.
    const cycleEvent = events.find((e) => e.actor === "loop-engine");
    expect(cycleEvent).toBeDefined();
    expect(cycleEvent?.reasonCodes).toContain("CYCLE_COMPLETE");
  });

  test("loop outputs compose: downstream loops receive upstream outputs", () => {
    const audit = newAudit();
    const receivedContexts: Array<{ loop: LoopName; context: Record<string, unknown> }> = [];

    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
      reconciliationEngine: new ReconciliationEngine(),
    });

    engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: {
        reconciliationInternal: {
          orders: [],
          fills: [],
          positions: [],
          balances: [],
        },
        reconciliationExternal: {
          orders: [],
          fills: [],
          positions: [],
          balances: [],
        },
      },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
        alpha: () => ({ opportunityCandidates: [{ id: "opp-1" }] }),
        debate: (ctx) => {
          receivedContexts.push({ loop: "debate", context: { ...ctx } });
          return { reviewedCandidates: [{ id: "opp-1", reviewed: true }] };
        },
        risk: (ctx) => {
          receivedContexts.push({ loop: "risk", context: { ...ctx } });
          return { riskDecisions: [{ decision: "APPROVE" }] };
        },
        execution: (ctx) => {
          receivedContexts.push({ loop: "execution", context: { ...ctx } });
          return { executionResults: [{ filled: true }] };
        },
        audit: (ctx) => {
          receivedContexts.push({ loop: "audit", context: { ...ctx } });
          return { auditSummary: {} };
        },
      },
    });

    // Debate should see data + graph + alpha outputs.
    const debateCtx = receivedContexts.find((r) => r.loop === "debate");
    expect(debateCtx).toBeDefined();
    expect(debateCtx!.context.normalizedMarketData).toEqual({ mid: 100 });
    expect(debateCtx!.context.graphSnapshot).toEqual({ version: 1 });
    expect(debateCtx!.context.opportunityCandidates).toEqual([
      { id: "opp-1" },
    ]);

    // Risk should see debate outputs too.
    const riskCtx = receivedContexts.find((r) => r.loop === "risk");
    expect(riskCtx).toBeDefined();
    expect(riskCtx!.context.reviewedCandidates).toEqual([
      { id: "opp-1", reviewed: true },
    ]);
  });
});

// ── Stopping criteria: halts the loop safely (AC2) ──────────────────────

describe("Loop halts safely when stopping criterion is met (AC2)", () => {
  test("data loop halts when all sources are disconnected", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { disconnectedSources: 3, totalSources: 3 },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
      },
    });

    expect(cycle.completed).toBe(false);
    expect(cycle.haltedLoop).toBe("data");
    expect(cycle.haltedReason).toBe(
      "All data sources are disconnected or stale",
    );
    expect(cycle.loopOutputs).toHaveLength(1);
    expect(cycle.loopOutputs[0].loopName).toBe("data");

    // State reflects the halt.
    const state = engine.loopState("data");
    expect(state.stopped).toBe(true);
    expect(state.stoppedReason).toBe(
      "All data sources are disconnected or stale",
    );
  });

  test("graph loop halts when graph is stale", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { graphStale: true },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
      },
    });

    expect(cycle.completed).toBe(false);
    expect(cycle.haltedLoop).toBe("graph");
    expect(cycle.haltedReason).toBe(
      "Graph has not been updated within the staleness threshold",
    );
  });

  test("alpha loop halts when no opportunities detected", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { opportunityCount: 0 },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
      },
    });

    expect(cycle.completed).toBe(false);
    expect(cycle.haltedLoop).toBe("alpha");
    expect(cycle.haltedReason).toBe(
      "No opportunities detected for the configured retention window",
    );
  });

  test("risk loop halts when risk limit is breached", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { riskLimitBreached: true },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
        alpha: () => ({ opportunityCandidates: [{ id: "opp-1" }] }),
        debate: () => ({ reviewedCandidates: [{ id: "opp-1" }] }),
      },
    });

    expect(cycle.completed).toBe(false);
    expect(cycle.haltedLoop).toBe("risk");
    expect(cycle.haltedReason).toBe(
      "Daily loss limit or exposure limit breached",
    );
  });

  test("execution loop halts when too many consecutive failures", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { consecutiveFailures: 5, maxConsecutiveFailures: 5 },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
        alpha: () => ({ opportunityCandidates: [{ id: "opp-1" }] }),
        debate: () => ({ reviewedCandidates: [{ id: "opp-1" }] }),
        risk: () => ({ riskDecisions: [{ decision: "APPROVE" }] }),
      },
    });

    expect(cycle.completed).toBe(false);
    expect(cycle.haltedLoop).toBe("execution");
    expect(cycle.haltedReason).toBe(
      "Too many consecutive execution failures",
    );
  });

  test("reconciliation loop halts on mismatch", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
      reconciliationEngine: new ReconciliationEngine(),
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: {
        reconciliationInternal: {
          orders: [{ orderId: "o-1", status: "OPEN", quantity: 1, filledQuantity: 0 }],
          fills: [],
          positions: [],
          balances: [],
        },
        reconciliationExternal: {
          orders: [],
          fills: [],
          positions: [],
          balances: [],
        },
      },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
        alpha: () => ({ opportunityCandidates: [{ id: "opp-1" }] }),
        debate: () => ({ reviewedCandidates: [{ id: "opp-1" }] }),
        risk: () => ({ riskDecisions: [{ decision: "APPROVE" }] }),
        execution: () => ({ executionResults: [{ filled: true }] }),
      },
    });

    expect(cycle.completed).toBe(false);
    expect(cycle.haltedLoop).toBe("reconciliation");
    expect(cycle.haltedReason).toBe(
      "Internal state diverges from external state beyond tolerance",
    );
  });

  test("audit loop halts when capacity is exhausted", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { auditCapacityExhausted: true },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
        alpha: () => ({ opportunityCandidates: [{ id: "opp-1" }] }),
        debate: () => ({ reviewedCandidates: [{ id: "opp-1" }] }),
        risk: () => ({ riskDecisions: [{ decision: "APPROVE" }] }),
        execution: () => ({ executionResults: [{ filled: true }] }),
        reconciliation: () => ({ reconciliationStatus: { ok: true } }),
      },
    });

    expect(cycle.completed).toBe(false);
    expect(cycle.haltedLoop).toBe("audit");
    expect(cycle.haltedReason).toBe(
      "Audit log storage capacity exhausted",
    );
  });

  test("debate loop halts when max debate rounds exceeded", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const cycle = engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { debateRounds: 10, maxDebateRounds: 10 },
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
        graph: () => ({ graphSnapshot: { version: 1 } }),
        alpha: () => ({ opportunityCandidates: [{ id: "opp-1" }] }),
      },
    });

    expect(cycle.completed).toBe(false);
    expect(cycle.haltedLoop).toBe("debate");
    expect(cycle.haltedReason).toBe(
      "Agent review exceeded the maximum debate rounds",
    );
  });

  test("halting is recorded in audit with the correct reason code", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { disconnectedSources: 1, totalSources: 1 },
    });

    const cycleEvent = audit
      .all()
      .find((e) => e.actor === "loop-engine");
    expect(cycleEvent).toBeDefined();
    expect(cycleEvent?.reasonCodes).toContain("LOOP_STOPPED");
    expect(cycleEvent?.data).toBeDefined();
    expect((cycleEvent!.data as Record<string, unknown>).completed).toBe(false);
    expect((cycleEvent!.data as Record<string, unknown>).haltedLoop).toBe(
      "data",
    );
  });
});

// ── State tracking across cycles ────────────────────────────────────────

describe("LoopEngine tracks state across cycles", () => {
  test("run count increments across cycles", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    engine.runCycle({ timestampMs: FIXED_TS });
    engine.runCycle({ timestampMs: FIXED_TS + 1_000 });

    const dataState = engine.loopState("data");
    expect(dataState.runCount).toBe(2);
    expect(dataState.lastRunAtMs).toBe(FIXED_TS + 1_000);
  });

  test("all loop states are accessible", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    engine.runCycle({ timestampMs: FIXED_TS });
    const states = engine.allLoopStates();
    expect(states.size).toBe(8);
    for (const name of LOOP_NAMES) {
      expect(states.has(name)).toBe(true);
      expect(isLoopState(states.get(name)!)).toBe(true);
    }
  });

  test("stopped loop remains stopped across subsequent cycles", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    // First cycle: data halts.
    engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { disconnectedSources: 2, totalSources: 2 },
    });
    expect(engine.loopState("data").stopped).toBe(true);

    // Second cycle: data is still halted, cycle halts at data immediately.
    const cycle2 = engine.runCycle({
      timestampMs: FIXED_TS + 1_000,
    });
    expect(cycle2.completed).toBe(false);
    expect(cycle2.haltedLoop).toBe("data");
    // The stopped loop is detected before it runs, so no output is produced.
    expect(cycle2.loopOutputs).toHaveLength(0);
  });
});

// ── Cycle ID uniqueness ─────────────────────────────────────────────────

describe("Cycle IDs are unique", () => {
  test("each cycle gets a unique ID", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const c1 = engine.runCycle({ timestampMs: FIXED_TS });
    const c2 = engine.runCycle({ timestampMs: FIXED_TS });
    expect(c1.cycleId).not.toBe(c2.cycleId);
  });
});

// ── Resume halted loop (S3 review fix) ──────────────────────────────────

describe("LoopEngine.resumeLoop (S3)", () => {
  test("resumes a halted loop so it runs again in the next cycle", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    // First cycle: data halts.
    engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { disconnectedSources: 2, totalSources: 2 },
    });
    expect(engine.loopState("data").stopped).toBe(true);

    // Resume the data loop.
    engine.resumeLoop("data", { timestampMs: FIXED_TS + 1_000 });
    expect(engine.loopState("data").stopped).toBe(false);
    expect(engine.loopState("data").stoppedReason).toBeUndefined();

    // Second cycle: data runs again.
    const cycle2 = engine.runCycle({
      timestampMs: FIXED_TS + 2_000,
      loopWork: {
        data: () => ({ normalizedMarketData: { mid: 100 } }),
      },
    });
    expect(cycle2.completed).toBe(true);
    expect(cycle2.loopOutputs[0].loopName).toBe("data");
  });

  test("resumeLoop records an audit event", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    engine.runCycle({
      timestampMs: FIXED_TS,
      systemInputs: { disconnectedSources: 1, totalSources: 1 },
    });

    const eventsBefore = audit.count();
    engine.resumeLoop("data", { timestampMs: FIXED_TS + 500 });
    const eventsAfter = audit.count();

    expect(eventsAfter).toBe(eventsBefore + 1);
    const resumeEvent = audit.last();
    expect(resumeEvent?.actor).toBe("loop-data");
    expect(resumeEvent?.reasonCodes).toContain("TRANSITION_ALLOWED");
    expect((resumeEvent?.data as Record<string, unknown>)?.action).toBe(
      "resumed",
    );
  });

  test("resumeLoop is a no-op for a loop that is already running", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    const eventsBefore = audit.count();
    engine.resumeLoop("data", { timestampMs: FIXED_TS });
    const eventsAfter = audit.count();

    // No audit event should be recorded for a no-op resume.
    expect(eventsAfter).toBe(eventsBefore);
    expect(engine.loopState("data").stopped).toBe(false);
  });

  test("resumeLoop throws for an unknown loop name", () => {
    const audit = newAudit();
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit,
      now: () => FIXED_TS,
    });

    expect(() => engine.resumeLoop("nonexistent" as LoopName)).toThrow(
      "unknown loop: nonexistent",
    );
  });
});
