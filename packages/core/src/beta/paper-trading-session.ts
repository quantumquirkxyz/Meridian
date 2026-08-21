import {
  type AuditEvent,
  type ApprovedRiskDecision,
  type ConsultativeAgentId,
  type ConsultativeAgentOutput,
  type OrderIntent,
  type ReduceRiskDecision,
  type RiskDecision,
  type RiskReasonCode,
  type StateName,
  type SystemMode,
} from "@agenttrading/contracts";
import {
  PaperExecutionEngine,
  type PaperOrderSnapshot,
} from "../execution/paper-execution-engine.ts";
import {
  type SimulatedFlowResult,
  type SimulatedFlowScenario,
  runSimulatedOpportunityFlow,
} from "../flow/simulated-flow.ts";
import {
  InventoryEngine,
  type BalanceEntry,
  type InventorySnapshot,
  type InventoryValidation,
  type PriceMap,
} from "../inventory/inventory-engine.ts";
import { ReconciliationEngine } from "../reconciliation/reconciliation-engine.ts";
import { DEFAULT_RISK_POLICY, RiskEngine } from "../risk/risk-gate.ts";
import { AuditLog } from "../stategraph/audit-log.ts";
import { StateGraph } from "../stategraph/state-graph.ts";
import {
  MODULE_ACTORS,
  buildDefaultGraph,
  defaultPermissionRegistry,
} from "../stategraph/topology.ts";

export type BetaControlCommand =
  | "start"
  | "stop"
  | "cancel-all"
  | "cash-only"
  | "reduce-only"
  | "halt";

export interface BetaPaperTradingScenario extends SimulatedFlowScenario {}

export interface BetaSessionStatus {
  running: boolean;
  mode: SystemMode;
  state: StateName;
  killSwitchActive: boolean;
  openPaperOrders: number;
  reportCount: number;
}

export interface BetaControlResult extends BetaSessionStatus {
  command: BetaControlCommand;
}

export interface BetaPostTradeReport {
  reportId: string;
  scenarioId: string;
  createdAtMs: number;
  paperOnly: true;
  finalState: StateName;
  finalMode: SystemMode;
  path: readonly StateName[];
  agentRecommendations: readonly ConsultativeAgentOutput[];
  orderIntent?: OrderIntent;
  riskDecision?: RiskDecision;
  execution?: PaperOrderSnapshot;
  inventory?: {
    snapshot: InventorySnapshot;
    validation: InventoryValidation;
  };
  reconstruction: {
    auditEventIds: readonly string[];
    auditLogLines: readonly string[];
    riskReasonCodes: readonly RiskReasonCode[];
  };
}

export interface BetaPaperCycleResult extends SimulatedFlowResult {
  auditEvents: readonly AuditEvent[];
  report: BetaPostTradeReport;
}

export interface BetaPaperTradingSessionOptions {
  now?: () => number;
}

function riskReasonCodes(decision: RiskDecision | undefined): RiskReasonCode[] {
  if (decision === undefined || !("reasonCodes" in decision)) return [];
  return [...decision.reasonCodes];
}

function executable(
  decision: RiskDecision | undefined,
): decision is ApprovedRiskDecision | ReduceRiskDecision {
  return (
    decision?.decision === "APPROVE" || decision?.decision === "REDUCE_SIZE"
  );
}

/**
 * Beta paper session: composes the deterministic Beta primitives without
 * giving UI or agents execution authority. The session is intentionally
 * ephemeral; every `start` creates a fresh paper-only StateGraph so defensive
 * modes cannot leak stale state into the next controlled run.
 */
export class BetaPaperTradingSession {
  private readonly now: () => number;
  private graph: StateGraph;
  private audit: AuditLog;
  private readonly riskGate = new RiskEngine(DEFAULT_RISK_POLICY);
  private readonly reconciliationEngine = new ReconciliationEngine();
  private readonly inventoryEngine = new InventoryEngine();
  private readonly paperExecution = new PaperExecutionEngine();
  private readonly postTradeReports: BetaPostTradeReport[] = [];
  private running = false;
  private halted = false;

  constructor(options: BetaPaperTradingSessionOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.audit = new AuditLog();
    this.graph = this.newGraph("PAPER_ONLY");
  }

  get status(): BetaSessionStatus {
    return {
      running: this.running,
      mode: this.graph.currentMode,
      state: this.graph.currentState,
      killSwitchActive: this.halted,
      openPaperOrders: 0,
      reportCount: this.postTradeReports.length,
    };
  }

  get reports(): readonly BetaPostTradeReport[] {
    return this.postTradeReports;
  }

  startPaperTrading(): BetaControlResult {
    if (this.halted) {
      throw new Error("kill switch is active; paper trading cannot restart");
    }
    this.audit = new AuditLog();
    this.graph = this.newGraph("PAPER_ONLY");
    this.running = true;
    return { command: "start", ...this.status };
  }

  stopPaperTrading(): BetaControlResult {
    this.running = false;
    this.audit = new AuditLog();
    this.graph = this.newGraph("PAPER_ONLY");
    return { command: "stop", ...this.status };
  }

  control(command: BetaControlCommand): BetaControlResult {
    switch (command) {
      case "start":
        return this.startPaperTrading();
      case "stop":
        return this.stopPaperTrading();
      case "cancel-all":
        return this.enterDefensiveMode(command, "CANCEL_ONLY_MODE");
      case "cash-only":
        return this.enterDefensiveMode(command, "CASH_ONLY_MODE");
      case "reduce-only":
        return this.enterDefensiveMode(command, "REDUCE_ONLY_MODE");
      case "halt":
        this.halted = true;
        return this.enterDefensiveMode(command, "HALT");
    }
  }

  runPaperCycle(scenario: BetaPaperTradingScenario): BetaPaperCycleResult {
    if (this.halted) {
      throw new Error("kill switch is active; no new paper cycles are allowed");
    }
    if (!this.running || this.graph.currentMode !== "PAPER_ONLY") {
      throw new Error("session is not in PAPER_ONLY mode");
    }

    const timestampMs = this.now();
    const flow = runSimulatedOpportunityFlow({
      graph: this.graph,
      riskGate: this.riskGate,
      reconciliationEngine: this.reconciliationEngine,
      scenario,
      timestampMs,
    });
    const execution = this.simulatePaperExecution(scenario, flow, timestampMs);
    const inventory = this.evaluateInventory(scenario, flow, timestampMs);
    const report = this.buildReport(
      scenario,
      flow,
      execution,
      inventory,
      timestampMs,
    );
    this.postTradeReports.push(report);
    return {
      ...flow,
      auditEvents: this.audit.all(),
      report,
    };
  }

  private newGraph(initialMode: SystemMode): StateGraph {
    const { nodes, transitions } = buildDefaultGraph();
    return new StateGraph({
      nodes,
      transitions,
      permissions: defaultPermissionRegistry(),
      audit: this.audit,
      now: this.now,
      initialMode,
    });
  }

  private enterDefensiveMode(
    command: BetaControlCommand,
    state: StateName,
  ): BetaControlResult {
    this.running = false;
    this.graph.transition({
      to: state,
      actor: MODULE_ACTORS.operator,
      timestampMs: this.now(),
    });
    return { command, ...this.status };
  }

  private simulatePaperExecution(
    scenario: BetaPaperTradingScenario,
    flow: SimulatedFlowResult,
    timestampMs: number,
  ): PaperOrderSnapshot | undefined {
    if (!executable(flow.riskDecision) || flow.orderIntent === undefined) {
      return undefined;
    }
    const execution = this.paperExecution.submit({
      intent: flow.orderIntent,
      riskDecision: flow.riskDecision,
      market: {
        bid: (scenario.price ?? 100) - 0.5,
        ask: (scenario.price ?? 100) + 0.5,
        mid: scenario.price ?? 100,
        liquidityUsd: Number.POSITIVE_INFINITY,
        latencyMs: 1,
      },
      submittedAtMs: timestampMs,
      acceptAfterMs: timestampMs,
      fillAfterMs: timestampMs,
    });
    this.paperExecution.poll(timestampMs);
    return execution;
  }

  private buildReport(
    scenario: BetaPaperTradingScenario,
    flow: SimulatedFlowResult,
    execution: PaperOrderSnapshot | undefined,
    inventory:
      | { snapshot: InventorySnapshot; validation: InventoryValidation }
      | undefined,
    timestampMs: number,
  ): BetaPostTradeReport {
    const auditEvents = this.audit.all();
    return {
      reportId: `post-trade-${scenario.id}`,
      scenarioId: scenario.id,
      createdAtMs: timestampMs,
      paperOnly: true,
      finalState: flow.finalState,
      finalMode: flow.finalMode,
      path: flow.path,
      agentRecommendations: this.agentRecommendations(scenario, flow),
      orderIntent: flow.orderIntent,
      riskDecision: flow.riskDecision,
      execution,
      inventory,
      reconstruction: {
        auditEventIds: auditEvents.map((event) => event.eventId),
        auditLogLines: this.audit.toLogLines(),
        riskReasonCodes: riskReasonCodes(flow.riskDecision),
      },
    };
  }

  private evaluateInventory(
    scenario: BetaPaperTradingScenario,
    flow: SimulatedFlowResult,
    timestampMs: number,
  ):
    | { snapshot: InventorySnapshot; validation: InventoryValidation }
    | undefined {
    if (flow.orderIntent === undefined) return undefined;

    const baseAsset = flow.orderIntent.symbol.split("/")[0] ?? "BTC";
    const quoteAsset = flow.orderIntent.quoteCurrency;
    const price = scenario.price ?? flow.orderIntent.price;
    const requiredNotionalUsd = flow.orderIntent.quantity * price;
    const balances: BalanceEntry[] = [
      {
        venueType: "CEX",
        venue: flow.orderIntent.venue,
        chain: "",
        asset: quoteAsset,
        available: requiredNotionalUsd * 2,
        locked: 0,
        exposed: 0,
        lastSyncAtMs: timestampMs,
      },
      {
        venueType: "CEX",
        venue: flow.orderIntent.venue,
        chain: "",
        asset: baseAsset,
        available: 0,
        locked: 0,
        exposed: flow.executedSize ?? 0,
        lastSyncAtMs: timestampMs,
      },
    ];
    const prices: PriceMap = {
      [baseAsset.toUpperCase()]: price,
      [quoteAsset.toUpperCase()]: 1,
    };
    const snapshot = this.inventoryEngine.snapshot({
      balances,
      prices,
      strategyAllocations: [
        {
          strategyId: "beta-paper",
          maxAllocationUsd: requiredNotionalUsd * 2,
          deployedUsd: 0,
        },
      ],
      evaluatedAtMs: timestampMs,
    });
    const validation = this.inventoryEngine.validate(
      {
        asset: quoteAsset,
        venue: flow.orderIntent.venue,
        side: "BUY",
        notionalUsd: requiredNotionalUsd,
        strategyId: "beta-paper",
        evaluatedAtMs: timestampMs,
      },
      snapshot,
    );
    return { snapshot, validation };
  }

  private agentRecommendations(
    scenario: BetaPaperTradingScenario,
    flow: SimulatedFlowResult,
  ): ConsultativeAgentOutput[] {
    const invalidationReasons = riskReasonCodes(flow.riskDecision);
    const confidence = flow.approved ? 0.82 : 0.34;
    const candidateId = flow.opportunity?.id ?? `opp-${scenario.id}`;
    const base = {
      confidence,
      assumptions: ["paper mode", "deterministic fixtures", "no real capital"],
      invalidationReasons,
    };
    return [
      {
        ...base,
        agentId: "agent-planner-supervisor" satisfies ConsultativeAgentId,
        summary: "Paper cycle can proceed only through risk-gated execution.",
        plannedSteps: [
          "observe market data",
          "review candidate",
          "submit approved paper order",
          "reconcile and audit",
        ],
        recommendedMode: "PAPER_ONLY",
      },
      {
        ...base,
        agentId: "agent-arbitrage-alpha",
        summary: "Candidate has a positive paper-mode edge before risk sizing.",
        candidateSignal: candidateId,
        expectedNetProfitUsd: scenario.expectedNetProfitUsd,
        invalidationReasons: [
          ...(invalidationReasons.length > 0
            ? invalidationReasons
            : ["MIN_EDGE" as const]),
        ] as [RiskReasonCode, ...RiskReasonCode[]],
        costBreakdownUsd: {
          feesUsd: 0,
          slippageUsd: 0,
          gasUsd: 0,
          bridgeCostUsd: 0,
          fundingCostUsd: 0,
          latencyRiskUsd: 0,
          failureRiskUsd: 0,
          safetyBufferUsd: 0,
        },
      },
      {
        ...base,
        agentId: "agent-risk-analyst",
        summary: "Risk authority remains deterministic; agent output is advisory.",
        riskNarrative: flow.riskDecision?.notes ?? "risk was not evaluated",
        controls: ["paper-only", "risk gate", "reconciliation", "audit trail"],
        residualRisks: ["fixture realism", "liquidity model simplification"],
      },
      {
        ...base,
        agentId: "agent-execution-advisor",
        summary: "Execution plan is limited to paper order simulation.",
        executionPlanCandidates: [
          {
            venue: scenario.venue ?? "bybit-paper",
            orderType: "limit",
            expectedNetProfitUsd: scenario.expectedNetProfitUsd,
            assumptions: ["simulated acceptance", "simulated fill"],
            invalidationReasons,
          },
        ],
        recommendedMode: "PAPER_ONLY",
      },
    ];
  }
}
