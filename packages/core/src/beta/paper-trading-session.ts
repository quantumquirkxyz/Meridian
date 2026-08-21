import {
  type AgentInput,
  type AgentRunResult,
  type AuditEvent,
  type AuditReasonCode,
  type BetaControlCommand,
  type BetaControlResult,
  type BetaControlStatus,
  type ConsultativeAgentId,
  type ConsultativeAgentOutput,
  type LoopCycle,
  type OrderIntent,
  type RiskDecision,
  type RiskReasonCode,
  type StateName,
  type SystemMode,
  parseConsultativeAgentOutput,
} from "@agenttrading/contracts";
import {
  PaperExecutionEngine,
  type PaperExecutionSubmitInput,
  type PaperMarketSnapshot,
  type PaperOrderSnapshot,
} from "../execution/paper-execution-engine.ts";
import {
  type SimulatedFlowResult,
  type SimulatedFlowScenario,
} from "../flow/simulated-flow.ts";
import {
  InventoryEngine,
  type BalanceEntry,
  type InventorySnapshot,
  type InventoryValidation,
  type PriceMap,
} from "../inventory/inventory-engine.ts";
import {
  defaultLoopDefinitions,
  LoopEngine,
} from "../loop/loop-engine.ts";
import {
  ReconciliationEngine,
  type ReconciliationReport,
  type ReconciliationSnapshot,
} from "../reconciliation/reconciliation-engine.ts";
import { DEFAULT_RISK_POLICY, RiskEngine } from "../risk/risk-gate.ts";
import { AuditLog } from "../stategraph/audit-log.ts";
import { StateGraph, type TransitionOutcome } from "../stategraph/state-graph.ts";
import {
  MODULE_ACTORS,
  buildDefaultGraph,
  defaultPermissionRegistry,
  isExecutableRiskOutcome,
} from "../stategraph/topology.ts";
import {
  Orchestrator,
  defaultFallbacks,
  defaultStateTimeouts,
} from "../stategraph/orchestrator.ts";

export interface BetaAgentRecommendationRunner {
  run(input: AgentInput): Promise<AgentRunResult>;
}

export interface BetaPaperInventoryInput {
  balances: readonly BalanceEntry[];
  prices: PriceMap;
  strategyAllocations?: readonly {
    strategyId: string;
    maxAllocationUsd: number;
    deployedUsd: number;
  }[];
}

export interface BetaReconciliationOptions {
  omitExternalFill?: boolean;
}

export interface BetaPaperExecutionOptions {
  acceptAfterMs?: number;
  fillAfterMs?: number;
  fillDelayMs?: number;
  cancelAfterMs?: number;
  rejectReason?: string;
  expiryAfterMs?: number;
  slippageBps?: number;
  feeBps?: number;
  fundingCostUsd?: number;
}

export interface BetaPaperTradingScenario extends SimulatedFlowScenario {
  paperInventory?: BetaPaperInventoryInput;
  paperExecution?: BetaPaperExecutionOptions;
  market?: Partial<PaperMarketSnapshot>;
  reconciliation?: BetaReconciliationOptions;
}

export interface BetaPostTradeReport {
  reportId: string;
  scenarioId: string;
  createdAtMs: number;
  paperOnly: true;
  finalState: StateName;
  finalMode: SystemMode;
  path: readonly StateName[];
  loopCycle: LoopCycle;
  agentRecommendations: readonly ConsultativeAgentOutput[];
  orderIntent?: OrderIntent;
  riskDecision?: RiskDecision;
  execution?: PaperOrderSnapshot;
  reconciliation?: ReconciliationReport;
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

export interface BetaPaperCycleResult
  extends Omit<SimulatedFlowResult, "transitions"> {
  transitions: readonly TransitionOutcome[];
  auditEvents: readonly AuditEvent[];
  loopCycle: LoopCycle;
  report: BetaPostTradeReport;
}

export interface BetaPaperTradingSessionOptions {
  now?: () => number;
  agentRunner?: BetaAgentRecommendationRunner;
}

type ExecutableRiskDecision = Extract<
  RiskDecision,
  { decision: "APPROVE" | "REDUCE_SIZE" }
>;

const AGENT_RECOMMENDATION_IDS = [
  "agent-planner-supervisor",
  "agent-arbitrage-alpha",
  "agent-market-regime",
  "agent-bull",
  "agent-bear",
  "agent-skeptic",
  "agent-risk-analyst",
  "agent-execution-advisor",
  "agent-memory",
  "agent-audit",
] as const satisfies readonly ConsultativeAgentId[];

const DEFAULT_QUOTE_BUFFER_MULTIPLIER = 2;
const DEFAULT_LIQUIDITY_USD = 1_000;
const DEFAULT_SPREAD = 0.5;
const DEFAULT_SLIPPAGE_BPS = 30;
const ORDER_TTL_MS = 60_000;

function riskReasonCodes(decision: RiskDecision | undefined): RiskReasonCode[] {
  if (decision === undefined || !("reasonCodes" in decision)) return [];
  return [...decision.reasonCodes];
}

function isExecutableRiskDecision(
  decision: RiskDecision | undefined,
): decision is ExecutableRiskDecision {
  return isExecutableRiskOutcome(decision?.decision);
}

function statusForPaperOrder(
  order: PaperOrderSnapshot,
): ReconciliationSnapshot["orders"][number]["status"] {
  if (order.state === "FILLED") return "CLOSED";
  if (order.state === "CANCELLED") return "CANCELLED";
  if (order.state === "REJECTED" || order.state === "EXPIRED") {
    return "REJECTED";
  }
  return "OPEN";
}

function defensiveStateForMode(mode: SystemMode): StateName | undefined {
  if (mode === "HALT") return "HALT";
  if (mode === "CANCEL_ONLY") return "CANCEL_ONLY_MODE";
  if (mode === "REDUCE_ONLY") return "REDUCE_ONLY_MODE";
  if (mode === "CASH_ONLY") return "CASH_ONLY_MODE";
  return undefined;
}

function structuredAgentPayload(
  result: AgentRunResult,
): ConsultativeAgentOutput | undefined {
  if (result.output.kind !== "structured") return undefined;
  try {
    return parseConsultativeAgentOutput(result.output.payload);
  } catch {
    return undefined;
  }
}

/**
 * Beta paper session: composes loops, advisory agents, risk, paper execution,
 * inventory, reconciliation, and audit in paper-only mode. UI code controls it
 * through a small command port; only deterministic engines can approve risk or
 * submit paper orders.
 */
export class BetaPaperTradingSession {
  private readonly now: () => number;
  private graph: StateGraph;
  private orchestrator: Orchestrator;
  private audit: AuditLog;
  private readonly riskGate = new RiskEngine(DEFAULT_RISK_POLICY);
  private readonly reconciliationEngine = new ReconciliationEngine();
  private readonly inventoryEngine = new InventoryEngine();
  private readonly paperExecution = new PaperExecutionEngine();
  private readonly agentRunner?: BetaAgentRecommendationRunner;
  private readonly postTradeReports: BetaPostTradeReport[] = [];
  private reportCounter = 0;
  private running = false;
  private halted = false;

  constructor(options: BetaPaperTradingSessionOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.agentRunner = options.agentRunner;
    this.audit = new AuditLog();
    this.graph = this.newGraph("PAPER_ONLY");
    this.orchestrator = this.newOrchestrator(this.graph);
  }

  get status(): BetaControlStatus {
    return {
      running: this.running,
      mode: this.graph.currentMode,
      state: this.graph.currentState,
      killSwitchActive: this.halted,
      openPaperOrders: this.paperExecution.openOrderCount(),
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
    if (this.graph.currentMode !== "PAPER_ONLY") {
      throw new Error(
        `cannot start from defensive mode ${this.graph.currentMode}; operator recovery is required`,
      );
    }
    this.running = true;
    return { command: "start", ...this.status };
  }

  stopPaperTrading(): BetaControlResult {
    this.running = false;
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
        return this.enterDefensiveMode(command, "HALT");
    }
  }

  async runPaperCycle(
    scenario: BetaPaperTradingScenario,
  ): Promise<BetaPaperCycleResult> {
    if (this.halted) {
      throw new Error("kill switch is active; no new paper cycles are allowed");
    }
    if (!this.running || this.graph.currentMode !== "PAPER_ONLY") {
      throw new Error("session is not in PAPER_ONLY mode");
    }

    const timestampMs = this.now();
    const path: StateName[] = ["IDLE"];
    const transitions: TransitionOutcome[] = [];
    let riskDecision: RiskDecision | undefined;
    let execution: PaperOrderSnapshot | undefined;
    let reconciliation: ReconciliationReport | undefined;

    const step = (
      to: StateName,
      actor: string,
      data?: Record<string, unknown>,
      reasonCodes?: readonly AuditReasonCode[],
    ): TransitionOutcome => {
      const outcome = this.orchestrator.transition({
        to,
        actor,
        data,
        reasonCodes,
        timestampMs,
      });
      transitions.push(outcome);
      if (outcome.ok) {
        path.push(outcome.state);
      } else {
        throw new Error(
          `beta paper cycle blocked at ${this.graph.currentState} -> ${to}: ${outcome.reasonCode}`,
        );
      }
      return outcome;
    };

    const candidate = {
      id: `opp-${scenario.id}`,
      snapshotId: `snap-${scenario.id}`,
      route: [...(scenario.route ?? ["venue:bybit-paper", "asset:BTC"])],
      grossSpreadUsd: scenario.grossSpreadUsd ?? 10,
      costs: {
        tradingFeesUsd: 0,
        slippageUsd: 0,
        gasUsd: 0,
        bridgeCostUsd: 0,
        fundingCostUsd: 0,
        latencyRiskUsd: 0,
        failureRiskUsd: 0,
        safetyBufferUsd: 0,
      },
      expectedNetProfitUsd: scenario.expectedNetProfitUsd,
      createdAtMs: timestampMs,
      status: scenario.expectedNetProfitUsd > 0 ? "CANDIDATE" : "INVALID",
      invalidationReasons:
        scenario.expectedNetProfitUsd > 0 ? undefined : ["MIN_EDGE" as const],
    };

    const loopCycle = this.runCanonicalLoopCycle(scenario, candidate, timestampMs);
    const agentRecommendations = await this.collectAgentRecommendations(
      scenario,
      candidate.id,
      timestampMs,
    );

    step("INGEST_MARKET_DATA", MODULE_ACTORS.marketDataSentinel, {
      source: scenario.venue ?? "bybit-paper",
    });
    step("NORMALIZE_MARKET_STATE", MODULE_ACTORS.normalizer, {
      normalizedMarketData: {
        venue: scenario.venue ?? "bybit-paper",
        symbol: scenario.symbol ?? "BTC/USDT",
        mid: scenario.price ?? 100,
      },
    });
    step("UPDATE_MARKET_GRAPH", MODULE_ACTORS.graphBuilder, {
      graphSnapshot: { snapshotId: candidate.snapshotId, version: 1 },
    });
    this.audit.record({
      eventId: `detected-${scenario.id}`,
      timestampMs,
      action: "OPPORTUNITY_DETECTED",
      actor: MODULE_ACTORS.opportunityScanner,
      state: "DETECT_OPPORTUNITY",
      reasonCodes: ["OPPORTUNITY_RECORDED"],
      data: candidate,
    });
    step("DETECT_OPPORTUNITY", MODULE_ACTORS.opportunityScanner, {
      candidates: [candidate],
    });

    if (candidate.status === "INVALID") {
      step("AUDIT_DECISION", MODULE_ACTORS.audit, {
        candidates: [candidate],
        cycleComplete: true,
      });
      step("IDLE", MODULE_ACTORS.audit, { cycleComplete: true }, [
        "CYCLE_COMPLETE",
      ]);
      return this.finishCycle({
        scenario,
        approved: false,
        path,
        transitions,
        loopCycle,
        agentRecommendations,
        riskDecision,
        execution,
        reconciliation,
        inventory: undefined,
        timestampMs,
      });
    }

    step("BUILD_ORDER_INTENT", MODULE_ACTORS.planner, {
      candidates: [candidate],
    });
    const orderIntent = this.buildOrderIntent(scenario, candidate.id, timestampMs);
    this.audit.record({
      eventId: `intent-${scenario.id}`,
      timestampMs,
      action: "ORDER_INTENT_CREATED",
      actor: MODULE_ACTORS.planner,
      state: "BUILD_ORDER_INTENT",
      reasonCodes: ["ORDER_INTENT_CREATED"],
      data: {
        idempotencyKey: orderIntent.idempotencyKey,
        opportunityId: candidate.id,
      },
    });

    const inventory = this.evaluateInventory(scenario, orderIntent, timestampMs);
    if (inventory.validation.blocked) {
      step("REQUEST_AGENT_REVIEW", MODULE_ACTORS.planner, {
        orderIntent,
        agentRecommendations,
      });
      step("RISK_VALIDATE", MODULE_ACTORS.agentReview, {
        agentReview: "PASS",
        orderIntent,
        inventoryBlocked: true,
        reasons: inventory.validation.reasons,
      }, ["RISK_REJECTED"]);
      riskDecision = this.riskGate.evaluate({
        orderIntent,
        expectedNetProfitUsd: scenario.expectedNetProfitUsd,
        mode: this.graph.currentMode,
        dataQualityScore: scenario.dataQualityScore,
        liquidityDepthUsd: this.market(scenario).liquidityUsd,
        evaluatedAtMs: timestampMs,
        inventoryBlocked: true,
      });
      this.audit.record({
        eventId: `risk-${scenario.id}`,
        timestampMs,
        action: "RISK_DECISION",
        actor: MODULE_ACTORS.riskEngine,
        state: "RISK_VALIDATE",
        reasonCodes: ["RISK_REJECTED"],
        data: {
          idempotencyKey: orderIntent.idempotencyKey,
          decision: riskDecision.decision,
          inventoryBlocked: true,
          inventoryReasons: inventory.validation.reasons,
          reasonCodes: riskReasonCodes(riskDecision),
        },
      });
      step("AUDIT_DECISION", MODULE_ACTORS.riskEngine, {
        riskDecisionOutcome: riskDecision.decision,
        riskDecision,
        orderIntent,
        inventoryBlocked: true,
        reasons: inventory.validation.reasons,
        cycleComplete: true,
      }, ["RISK_REJECTED"]);
      step("IDLE", MODULE_ACTORS.audit, { cycleComplete: true }, [
        "CYCLE_COMPLETE",
      ]);
      return this.finishCycle({
        scenario,
        approved: false,
        path,
        transitions,
        loopCycle,
        agentRecommendations,
        orderIntent,
        riskDecision,
        execution,
        reconciliation,
        inventory,
        timestampMs,
      });
    }

    step("REQUEST_AGENT_REVIEW", MODULE_ACTORS.planner, {
      orderIntent,
      agentRecommendations,
    });
    step("RISK_VALIDATE", MODULE_ACTORS.agentReview, {
      agentReview: "PASS",
      agentRecommendations,
    });
    riskDecision = this.riskGate.evaluate({
      orderIntent,
      expectedNetProfitUsd: scenario.expectedNetProfitUsd,
      mode: this.graph.currentMode,
      dataQualityScore: scenario.dataQualityScore,
      liquidityDepthUsd: this.market(scenario).liquidityUsd,
      evaluatedAtMs: timestampMs,
    });
    this.audit.record({
      eventId: `risk-${scenario.id}`,
      timestampMs,
      action: "RISK_DECISION",
      actor: MODULE_ACTORS.riskEngine,
      state: "RISK_VALIDATE",
      reasonCodes: isExecutableRiskDecision(riskDecision)
        ? ["RISK_APPROVED"]
        : ["RISK_REJECTED"],
      data: {
        idempotencyKey: orderIntent.idempotencyKey,
        decision: riskDecision.decision,
        reasonCodes: riskReasonCodes(riskDecision),
      },
    });

    if (!isExecutableRiskDecision(riskDecision)) {
      step("AUDIT_DECISION", MODULE_ACTORS.riskEngine, {
        riskDecisionOutcome: riskDecision.decision,
        riskDecision,
        candidates: [{ ...candidate, status: "REJECTED" }],
        cycleComplete: true,
      }, ["RISK_REJECTED"]);
      step("IDLE", MODULE_ACTORS.audit, { cycleComplete: true }, [
        "CYCLE_COMPLETE",
      ]);
      return this.finishCycle({
        scenario,
        approved: false,
        path,
        transitions,
        loopCycle,
        agentRecommendations,
        orderIntent,
        riskDecision,
        execution,
        reconciliation,
        inventory,
        timestampMs,
      });
    }

    step("EXECUTION_PRECHECK", MODULE_ACTORS.riskEngine, {
      riskDecisionOutcome: riskDecision.decision,
      riskDecision,
      orderIntent,
      inventoryValidation: inventory.validation,
    }, ["RISK_APPROVED"]);
    execution = this.executePaperOrder(scenario, orderIntent, riskDecision, timestampMs);
    step("EXECUTE_ORDER", MODULE_ACTORS.executionEngine, {
      precheck: "PASS",
      expectedNetProfitUsd: scenario.expectedNetProfitUsd,
      riskDecision,
      orderIntent,
      execution,
    }, ["EXECUTION_SIMULATED"]);
    reconciliation = this.reconcilePaperOrder(
      scenario,
      execution,
      timestampMs,
    );
    step("RECONCILE", MODULE_ACTORS.executionEngine, {
      orderIntent,
      execution,
      reconciliation,
    }, reconciliation.reasonCodes);

    const defensiveState = defensiveStateForMode(reconciliation.defensiveMode);
    if (defensiveState !== undefined) {
      step(defensiveState, MODULE_ACTORS.infraGuardian, {
        reconciliation,
      }, reconciliation.reasonCodes);
      this.running = false;
    } else {
      step("AUDIT_DECISION", MODULE_ACTORS.audit, {
        orderIntent,
        riskDecision,
        execution,
        reconciliation,
      }, reconciliation.reasonCodes);
      step("IDLE", MODULE_ACTORS.audit, { cycleComplete: true }, [
        "CYCLE_COMPLETE",
      ]);
    }

    return this.finishCycle({
      scenario,
      approved: !reconciliation.unresolved,
      path,
      transitions,
      loopCycle,
      agentRecommendations,
      orderIntent,
      riskDecision,
      execution,
      reconciliation,
      inventory,
      timestampMs,
    });
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

  private newOrchestrator(graph: StateGraph): Orchestrator {
    return new Orchestrator({
      graph,
      permissions: graph.permissionRegistry,
      audit: this.audit,
      stateTimeouts: defaultStateTimeouts(),
      fallbacks: defaultFallbacks(),
      now: this.now,
    });
  }

  private enterDefensiveMode(
    command: BetaControlCommand,
    state: StateName,
  ): BetaControlResult {
    this.running = false;
    const timestampMs = this.now();
    const cancelledOrders =
      command === "cancel-all" || command === "halt"
        ? this.paperExecution.cancelAll(timestampMs)
        : [];
    const outcome =
      state === "HALT"
        ? this.orchestrator.transition({
            to: state,
            actor: MODULE_ACTORS.operator,
            timestampMs,
            data: { killSwitch: true },
          })
        : this.orchestrator.enterDegradedMode(
            state,
            MODULE_ACTORS.operator,
            `operator requested ${command}`,
          );
    if (!outcome.ok) {
      throw new Error(
        `control command ${command} failed to enter ${state}: ${outcome.reasonCode}`,
      );
    }
    if (state === "HALT") {
      this.halted = true;
    }
    if (cancelledOrders.length > 0) {
      this.audit.record({
        eventId: `cancel-all-${timestampMs}`,
        timestampMs,
        action: "DATA_QUALITY_EVENT",
        actor: MODULE_ACTORS.operator,
        state,
        reasonCodes: ["DEFENSIVE_MODE_ENTERED"],
        data: {
          command,
          cancelledOrderIds: cancelledOrders.map((order) => order.orderId),
        },
      });
    }
    return { command, ...this.status };
  }

  private runCanonicalLoopCycle(
    scenario: BetaPaperTradingScenario,
    candidate: Record<string, unknown>,
    timestampMs: number,
  ): LoopCycle {
    const engine = new LoopEngine({
      loops: defaultLoopDefinitions(),
      audit: this.audit,
      now: this.now,
      reconciliationEngine: this.reconciliationEngine,
    });
    return engine.runCycle({
      timestampMs,
      systemInputs: {
        rawMarketData: { venue: scenario.venue ?? "bybit-paper" },
        maxDebateRounds: 3,
      },
      loopWork: {
        data: () => ({
          normalizedMarketData: {
            symbol: scenario.symbol ?? "BTC/USDT",
            mid: scenario.price ?? 100,
          },
          dataQualityReport: { score: scenario.dataQualityScore ?? 1 },
        }),
        graph: () => ({
          graphSnapshot: { snapshotId: candidate.snapshotId, version: 1 },
        }),
        alpha: () => ({ opportunityCandidates: [candidate] }),
        debate: () => ({ reviewedCandidates: [candidate] }),
        risk: () => ({ riskDecisions: [] }),
        execution: () => ({ executionResults: [] }),
        reconciliation: () => ({
          reconciliationStatus: {
            unresolved: false,
            reasonCodes: ["RECONCILIATION_OK"],
          },
        }),
        audit: () => ({
          auditSummary: {
            paperOnly: true,
            candidateId: candidate.id,
          },
        }),
      },
    });
  }

  private async collectAgentRecommendations(
    scenario: BetaPaperTradingScenario,
    candidateId: string,
    timestampMs: number,
  ): Promise<ConsultativeAgentOutput[]> {
    if (this.agentRunner === undefined) {
      return this.fallbackRecommendations(scenario, candidateId);
    }

    const results: ConsultativeAgentOutput[] = [];
    for (const agentId of AGENT_RECOMMENDATION_IDS) {
      try {
        const result = await this.agentRunner.run({
          agentId,
          payload: {
            candidateId,
            scenario,
            paperOnly: true,
          },
          permissions: ["OBSERVE_STATE", "PROPOSE_RISK_REVIEW"],
          timestampMs,
        });
        const payload = structuredAgentPayload(result);
        results.push(
          payload ?? this.fallbackRecommendationFor(agentId, scenario, candidateId),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.audit.record({
          eventId: `agent-fallback-${scenario.id}-${agentId}`,
          timestampMs,
          action: "DATA_QUALITY_EVENT",
          actor: agentId,
          state: this.graph.currentState,
          reasonCodes: ["FALLBACK_EXECUTED"],
          data: {
            agentId,
            fallback: true,
            error: message,
          },
        });
        throw new Error(`agent ${agentId} runtime failure: ${message}`);
      }
    }
    return results.length > 0
      ? results
      : this.fallbackRecommendations(scenario, candidateId);
  }

  private buildOrderIntent(
    scenario: BetaPaperTradingScenario,
    opportunityId: string,
    timestampMs: number,
  ): OrderIntent {
    return {
      idempotencyKey: `intent-${scenario.id}`,
      opportunityId,
      venue: scenario.venue ?? "bybit-paper",
      symbol: scenario.symbol ?? "BTC/USDT",
      side: "BUY",
      quantity: scenario.quantity ?? 0.01,
      price: scenario.price ?? 100,
      quoteCurrency: "USDT",
      createdAtMs: timestampMs,
      expiresAtMs: timestampMs + ORDER_TTL_MS,
      limits: { maxSlippageBps: DEFAULT_SLIPPAGE_BPS },
    };
  }

  private evaluateInventory(
    scenario: BetaPaperTradingScenario,
    orderIntent: OrderIntent,
    timestampMs: number,
  ): { snapshot: InventorySnapshot; validation: InventoryValidation } {
    const baseAsset = orderIntent.symbol.split("/")[0] ?? "BTC";
    const quoteAsset = orderIntent.quoteCurrency;
    const requiredNotionalUsd = orderIntent.quantity * orderIntent.price;
    const paperInventory = scenario.paperInventory ?? {
      balances: [
        {
          venueType: "CEX" as const,
          venue: orderIntent.venue,
          chain: "",
          asset: quoteAsset,
          available: requiredNotionalUsd * 2,
          locked: 0,
          exposed: 0,
          lastSyncAtMs: timestampMs,
        },
        {
          venueType: "CEX" as const,
          venue: orderIntent.venue,
          chain: "",
          asset: baseAsset,
          available: 0,
          locked: 0,
          exposed: 0,
          lastSyncAtMs: timestampMs,
        },
      ],
      prices: {
        [baseAsset.toUpperCase()]: orderIntent.price,
        [quoteAsset.toUpperCase()]: 1,
      },
      strategyAllocations: [
        {
          strategyId: "beta-paper",
          maxAllocationUsd: requiredNotionalUsd * DEFAULT_QUOTE_BUFFER_MULTIPLIER,
          deployedUsd: 0,
        },
      ],
    };
    const snapshot = this.inventoryEngine.snapshot({
      balances: paperInventory.balances,
      prices: paperInventory.prices,
      strategyAllocations: paperInventory.strategyAllocations,
      evaluatedAtMs: timestampMs,
    });
    const validation = this.inventoryEngine.validate(
      {
        asset: quoteAsset,
        venue: orderIntent.venue,
        side: "BUY",
        notionalUsd: requiredNotionalUsd,
        strategyId: "beta-paper",
        evaluatedAtMs: timestampMs,
      },
      snapshot,
    );
    return { snapshot, validation };
  }

  private market(scenario: BetaPaperTradingScenario): PaperMarketSnapshot {
    const price = scenario.price ?? 100;
    return {
      bid: price - DEFAULT_SPREAD,
      ask: price + DEFAULT_SPREAD,
      mid: price,
      liquidityUsd: DEFAULT_LIQUIDITY_USD,
      latencyMs: 1,
      ...scenario.market,
    };
  }

  private executePaperOrder(
    scenario: BetaPaperTradingScenario,
    orderIntent: OrderIntent,
    riskDecision: ExecutableRiskDecision,
    timestampMs: number,
  ): PaperOrderSnapshot {
    const executionOptions = scenario.paperExecution ?? {};
    const execution = this.paperExecution.submit({
      intent: orderIntent,
      riskDecision,
      market: this.market(scenario),
      submittedAtMs: timestampMs,
      acceptAfterMs: executionOptions.acceptAfterMs ?? timestampMs,
      fillAfterMs: executionOptions.fillAfterMs ?? timestampMs,
      fillDelayMs: executionOptions.fillDelayMs,
      cancelAfterMs: executionOptions.cancelAfterMs,
      rejectReason: executionOptions.rejectReason,
      expiryAfterMs: executionOptions.expiryAfterMs,
      slippageBps: executionOptions.slippageBps,
      feeBps: executionOptions.feeBps,
      fundingCostUsd: executionOptions.fundingCostUsd,
    } satisfies PaperExecutionSubmitInput);
    this.paperExecution.poll(timestampMs);
    return execution;
  }

  private reconcilePaperOrder(
    scenario: BetaPaperTradingScenario,
    execution: PaperOrderSnapshot,
    timestampMs: number,
  ): ReconciliationReport {
    const baseAsset = execution.intent.symbol.split("/")[0] ?? "BTC";
    const quoteAsset = execution.intent.quoteCurrency;
    const filledQuantity = execution.filledQuantity;
    const fillPrice = execution.averageFillPrice ?? execution.intent.price;
    const order = {
      orderId: execution.orderId,
      status: statusForPaperOrder(execution),
      quantity: execution.approvedQuantity,
      filledQuantity,
    };
    const fill = {
      fillId: `fill-${execution.orderId}`,
      orderId: execution.orderId,
      quantity: filledQuantity,
      price: fillPrice,
    };
    const internal: ReconciliationSnapshot = {
      orders: [order],
      fills: filledQuantity > 0 ? [fill] : [],
      positions: filledQuantity > 0
        ? [{
            symbol: execution.intent.symbol,
            quantity: filledQuantity,
            averagePrice: fillPrice,
          }]
        : [],
      balances: [
        { asset: quoteAsset, available: 1_000, locked: 0 },
        { asset: baseAsset, available: filledQuantity, locked: 0 },
      ],
    };
    const external: ReconciliationSnapshot = {
      ...internal,
      fills: scenario.reconciliation?.omitExternalFill ? [] : internal.fills,
    };
    return this.reconciliationEngine.reconcile({
      internal,
      external,
      reconciledAtMs: timestampMs,
    });
  }

  private finishCycle(options: {
    scenario: BetaPaperTradingScenario;
    approved: boolean;
    path: readonly StateName[];
    transitions: readonly TransitionOutcome[];
    loopCycle: LoopCycle;
    agentRecommendations: readonly ConsultativeAgentOutput[];
    orderIntent?: OrderIntent;
    riskDecision?: RiskDecision;
    execution?: PaperOrderSnapshot;
    reconciliation?: ReconciliationReport;
    inventory?: {
      snapshot: InventorySnapshot;
      validation: InventoryValidation;
    };
    timestampMs: number;
  }): BetaPaperCycleResult {
    const auditEvents = this.audit.all();
    const report: BetaPostTradeReport = {
      reportId: `post-trade-${options.scenario.id}-${options.timestampMs}-${++this.reportCounter}`,
      scenarioId: options.scenario.id,
      createdAtMs: options.timestampMs,
      paperOnly: true,
      finalState: this.graph.currentState,
      finalMode: this.graph.currentMode,
      path: options.path,
      loopCycle: options.loopCycle,
      agentRecommendations: options.agentRecommendations,
      orderIntent: options.orderIntent,
      riskDecision: options.riskDecision,
      execution: options.execution,
      reconciliation: options.reconciliation,
      inventory: options.inventory,
      reconstruction: {
        auditEventIds: auditEvents.map((event) => event.eventId),
        auditLogLines: this.audit.toLogLines(),
        riskReasonCodes: riskReasonCodes(options.riskDecision),
      },
    };
    this.postTradeReports.push(report);
    return {
      scenarioId: options.scenario.id,
      approved: options.approved,
      finalState: this.graph.currentState,
      finalMode: this.graph.currentMode,
      path: options.path,
      transitions: options.transitions,
      opportunity: undefined,
      orderIntent: options.orderIntent,
      riskDecision: options.riskDecision,
      executedSize: options.execution?.filledQuantity,
      logs: this.audit.toLogLines(),
      auditEvents,
      loopCycle: options.loopCycle,
      report,
    };
  }

  private fallbackRecommendationFor(
    agentId: ConsultativeAgentId,
    scenario: BetaPaperTradingScenario,
    candidateId: string,
    options: { runtimeError?: string } = {},
  ): ConsultativeAgentOutput {
    const invalidationReasons =
      scenario.expectedNetProfitUsd > 0 ? [] : ["MIN_EDGE" as RiskReasonCode];
    const alphaInvalidationReasons: [RiskReasonCode, ...RiskReasonCode[]] =
      invalidationReasons.length > 0
        ? [invalidationReasons[0] as RiskReasonCode, ...invalidationReasons.slice(1)]
        : ["MIN_EDGE"];
    const summaryPrefix = options.runtimeError === undefined
      ? "Fallback"
      : `Runtime error (${options.runtimeError}); deterministic fallback`;
    const base = {
      confidence: scenario.expectedNetProfitUsd > 0 ? 0.75 : 0.25,
      assumptions: ["paper mode", "deterministic fallback", "no real capital"],
      invalidationReasons,
    };

    switch (agentId) {
      case "agent-planner-supervisor":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} planner keeps the candidate inside the paper cycle.`,
          plannedSteps: [
            "run loops",
            "collect advisory review",
            "risk validate",
            "paper execute",
            "reconcile",
            "audit",
          ],
          recommendedMode: "PAPER_ONLY",
        };
      case "agent-arbitrage-alpha":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} alpha reports the scenario-provided candidate edge.`,
          candidateSignal: candidateId,
          expectedNetProfitUsd: scenario.expectedNetProfitUsd,
          invalidationReasons: alphaInvalidationReasons,
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
        };
      case "agent-market-regime":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} market regime classifies the fixture conservatively.`,
          regime: "unknown",
          recommendedMode: "PAPER_ONLY",
        };
      case "agent-bull":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} bull case remains advisory only.`,
          candidateId,
          confidenceDelta: scenario.expectedNetProfitUsd > 0 ? 0.05 : 0,
          invalidationReasons,
          stance: "bullish",
        };
      case "agent-bear":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} bear case checks downside before risk authority.`,
          candidateId,
          confidenceDelta: scenario.expectedNetProfitUsd > 0 ? -0.05 : -0.2,
          invalidationReasons,
          stance: "bearish",
        };
      case "agent-skeptic":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} skeptic requires deterministic evidence before execution.`,
          candidateId,
          confidenceDelta: -0.1,
          invalidationReasons,
          stance: "skeptical",
          requiredEvidence: ["risk decision", "inventory validation", "reconciliation"],
        };
      case "agent-risk-analyst":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} risk analyst defers authority to the Risk Engine.`,
          riskNarrative: "Risk authority remains deterministic.",
          controls: ["risk gate", "paper-only", "reconciliation", "audit"],
          residualRisks: ["fixture realism"],
        };
      case "agent-execution-advisor":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} execution advisor restricts execution to paper mode.`,
          executionPlanCandidates: [
            {
              venue: scenario.venue ?? "bybit-paper",
              orderType: "limit",
              expectedNetProfitUsd: scenario.expectedNetProfitUsd,
              assumptions: ["paper order state machine"],
              invalidationReasons,
            },
          ],
          recommendedMode: "PAPER_ONLY",
        };
      case "agent-memory":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} memory recalls no production-capital precedent.`,
          recalledCases: [
            {
              caseId: `memory-${scenario.id}`,
              pattern: "paper-only beta cycle",
              relevance: 0.5,
              warning: "do not extrapolate paper fills to live venues",
            },
          ],
          recalledPerformance: [],
          recommendedFollowUps: ["persist audit trail", "review reconciliation"],
        };
      case "agent-audit":
        return {
          ...base,
          agentId,
          summary: `${summaryPrefix} audit agent requests a complete post-trade report.`,
          qualityScore: 0.75,
          decisionSummary: "Decision remains reconstructable from deterministic logs.",
          consistencyFindings: [],
          failurePatterns: options.runtimeError === undefined
            ? []
            : [`agent runtime fallback: ${options.runtimeError}`],
        };
      default:
        throw new Error(`unknown agent ${agentId}`);
    }
  }

  private fallbackRecommendations(
    scenario: BetaPaperTradingScenario,
    candidateId: string,
  ): ConsultativeAgentOutput[] {
    return AGENT_RECOMMENDATION_IDS.map((agentId) =>
      this.fallbackRecommendationFor(agentId, scenario, candidateId)
    );
  }
}
