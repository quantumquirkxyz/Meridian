/**
 * TradingSession: the top-level integration that wires all canary subsystems
 * together for a go-live canary session (issue #40).
 *
 * Acceptance criteria:
 *   AC1: All canary subsystems integrate and run together.
 *   AC2: A go-live canary session completes within hard limits.
 *   AC3: Every decision/outcome is auditable; failures degrade safely.
 *   AC4: canary exit criterion met: live with bounded capital, preserves
 *        limits, adapts, learns governed, auditable, scales only with
 *        evidence.
 *
 * The session is deterministic — no LLM, no I/O. It orchestrates:
 *   - CanarySession: bounded capital, per-trade/day/venue limits,
 *     kill switch, emergency modes.
 *   - RegimeClassifier + RegimePolicyEngine: market regime adaptation
 *     that adjusts permissions without increasing them.
 *   - LearningEngine: governed learning loop (journal, edge decay,
 *     promotion pipeline).
 *   - AuditReconstructor + ReportGenerator: end-to-end audit trail,
 *     daily/weekly reports, TXT/JSON/CSV export.
 *   - RouteEngine + SystemicRiskOverlay: route discovery with risk overlays.
 *
 * Usage:
 * ```ts
 * const session = new TradingSession({ config: myConfig });
 * session.start();
 *
 * // Each tick: classify regime → discover routes → submit orders → record fills
 * const result = session.runCycle({
 *   regime: { realizedVolatility: 0.3, ... },
 *   market: { bid: 99, ask: 101, mid: 100, liquidityUsd: 10_000 },
 *   intents: [orderIntent1, ...],
 *   riskDecisions: [riskDecision1, ...],
 * });
 *
 * // End of session
 * session.stop();
 * const summary = session.getSessionSummary();
 * ```
 */

import type {
  CanaryConfig,
  CanaryControlCommand,
  LearningRecommendation,
  MarketGraphSnapshot,
  OrderIntent,
  OrderRouteAck,
  OrderRouter,
  PromotionRecord,
  RegimeClassification,
  RegimePolicy,
  RiskDecision,
  RouteDiscoveryResult,
  TradeReconstruction,
  TradeReport,
} from "@agenttrading/contracts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";
import { type RegimeClassifierInput } from "@agenttrading/core-session";
import { RegimeClassifier } from "@agenttrading/core-session";
import { RegimePolicyEngine } from "@agenttrading/core-session";
import { CanarySession } from "@agenttrading/core-session";
import { type CanaryPreCheckResult } from "@agenttrading/core-execution";
import { LearningEngine } from "@agenttrading/core-session";
import { RouteEngine } from "@agenttrading/core-session";
import { AuditReconstructor } from "@agenttrading/core-session";
import { ReportGenerator } from "@agenttrading/core-session";
import { AuditExporter } from "@agenttrading/core-session";
import type { TradeJournal } from "@agenttrading/core-session";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Input for a single TradingSession cycle.
 */
export interface TradingCycleInput {
  /** Market signals for regime classification. */
  regime: RegimeClassifierInput;
  /** Market snapshot for order execution. */
  market: { bid: number; ask: number; mid: number; liquidityUsd: number };
  /** Order intents to evaluate in this cycle. */
  intents: OrderIntent[];
  /** Risk decisions for the intents (parallel array). */
  riskDecisions: RiskDecision[];
  /** Optional market graph snapshot for route discovery (SP1). */
  snapshot?: MarketGraphSnapshot;
}

/**
 * Result of a single TradingSession cycle.
 */
export interface TradingCycleResult {
  /** Whether the cycle ran successfully. */
  ok: boolean;
  /** Error message if the cycle failed. */
  error?: string;
  /** Regime classification for this cycle. */
  regimeClassification?: RegimeClassification;
  /** Active regime policy after evaluation. */
  regimePolicy?: RegimePolicy;
  /** Whether the regime changed in this cycle. */
  regimeChanged: boolean;
  /** Whether regime change was blocked (permissions increase). */
  regimeChangeBlocked: boolean;
  /** Block reason if regime change was blocked. */
  regimeChangeBlockReason?: string;
  /** Emergency action triggered by regime change, if any. */
  emergencyAction?: string;
  /** Orders submitted in this cycle. */
  submittedCount: number;
  /** Orders blocked by canary limits. */
  blockedCount: number;
  /** Orders blocked by regime policy. */
  regimeBlockedCount: number;
  /** Learning recommendations from this cycle (if learning cycle ran). */
  learningRecommendations: LearningRecommendation[];
  /** Whether a learning cycle ran in this cycle. */
  learningCycleRan: boolean;
  /** Route discovery results when a snapshot was provided (SP1). */
  routeDiscovery?: RouteDiscoveryResult;
}

/**
 * The complete session summary produced at session end.
 */
export interface TradingSessionSummary {
  /** Whether the session completed normally. */
  completedNormally: boolean;
  /** Final canary status. */
  canaryStatus: {
    running: boolean;
    mode: string;
    killSwitchActive: boolean;
    capitalDeployedUsd: number;
    capitalRemainingUsd: number;
    dailyPnlUsd: number;
    weeklyPnlUsd: number;
    orphanOrderCount: number;
    reconciliationUnresolved: boolean;
  };
  /** Final regime classification. */
  regimeClassification?: RegimeClassification;
  /** Regime change history. */
  regimeChangeHistory: readonly unknown[];
  /** Per-regime performance records. */
  regimePerformance: Record<string, unknown>;
  /** Trade journal entry count. */
  journalEntryCount: number;
  /** Daily trade report. */
  dailyReport?: TradeReport;
  /** Weekly trade report. */
  weeklyReport?: TradeReport;
  /** All trade reconstructions. */
  reconstructions: Map<string, TradeReconstruction>;
  /** Exported reports in all formats. */
  exportedReports: {
    dailyJson?: string;
    dailyCsv?: string;
    dailyTxt?: string;
  };
  /** Learning recommendations from the session. */
  learningRecommendations: LearningRecommendation[];
  /** Active promotions in the pipeline (SP2). */
  activePromotions: readonly PromotionRecord[];
  /** All promotion records (SP2). */
  allPromotions: readonly PromotionRecord[];
  /** Audit event count. */
  auditEventCount: number;
}

// ── Session Options ──────────────────────────────────────────────────

export interface TradingSessionOptions {
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Custom canary config; defaults to DEFAULT_CANARY_CONFIG. */
  canaryConfig?: CanaryConfig;
  /** Learning cycle interval (cycles). Defaults to 10. */
  learningCycleInterval?: number;
}

// ── TradingSession ─────────────────────────────────────────────────────

/**
 * TradingSession: the top-level integration that wires all canary subsystems
 * together for a go-live canary session.
 */
import type { AgentInput, AgentOutput } from "@agenttrading/contracts";

export class TradingSession {
  private readonly now: () => number;
  private readonly learningCycleInterval: number;
  private cycleCount = 0;
  private auditSequence = 0;

  // Core subsystems
  private readonly canarySession: CanarySession;
  private readonly regimeClassifier: RegimeClassifier;
  private readonly regimePolicyEngine: RegimePolicyEngine;
  private readonly learningEngine: LearningEngine;
  private readonly routeEngine: RouteEngine;
  private readonly auditReconstructor: AuditReconstructor;
  private readonly auditExporter: AuditExporter;

  // State
  private running = false;
  private lastRegimeClassification: RegimeClassification | null = null;
  private allRecommendations: LearningRecommendation[] = [];

  constructor(options: TradingSessionOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.learningCycleInterval = options.learningCycleInterval ?? 10;

    // Initialize subsystems (order matters: learningEngine must exist before
    // canarySession so its journal can be shared).
    this.regimeClassifier = new RegimeClassifier();
    this.regimePolicyEngine = new RegimePolicyEngine({ now: this.now });
    this.learningEngine = new LearningEngine(undefined, this.now);
    this.routeEngine = new RouteEngine(undefined, this.now);
    this.canarySession = new CanarySession({
      now: this.now,
      config: options.canaryConfig ?? DEFAULT_CANARY_CONFIG,
      journal: this.learningEngine.journal,
    });
    this.auditReconstructor = new AuditReconstructor(undefined, this.now);
    this.auditExporter = new AuditExporter();
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Start the canary session. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.canarySession.control("start");
  }

  /** Stop the canary session and cancel open orders. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.canarySession.control("stop");
    this.regimePolicyEngine.finalize();
  }

  /** Process a control command (delegates to CanarySession). */
  control(command: CanaryControlCommand) {
    return this.canarySession.control(command);
  }

  /** Late-wire an OrderRouter (ADR-0011) into the canary execution engine. */
  setOrderRouter(orderRouter?: OrderRouter): void {
    this.canarySession.setOrderRouter(orderRouter);
  }

  /** Whether a live OrderRouter is attached (ADR-0011 seam active). */
  get hasOrderRouter(): boolean {
    return this.canarySession.hasOrderRouter;
  }

  /** Canary pre-check for an intent (delegates to CanarySession). */
  preCheckIntent(intent: OrderIntent): CanaryPreCheckResult {
    return this.canarySession.preCheckIntent(intent);
  }

  /** Place a live order through the engine OrderRouter (ADR-0011). */
  placeLiveOrder(
    intent: OrderIntent,
    preCheck: CanaryPreCheckResult,
    riskDecision: RiskDecision,
  ): Promise<OrderRouteAck> {
    return this.canarySession.placeLiveOrder(intent, preCheck, riskDecision);
  }

  // AgentAdapter interface contract (isolated from LLM framework).
  // Use wireAgentAdapter() to connect a concrete adapter at startup.
  private adapter?: {
    run(input: AgentInput): AgentOutput;
  };

  /** Wire AgentAdapter for typed agent observations (ADR-0003). */
  wireAgentAdapter(adapter: { run(input: AgentInput): AgentOutput }): void {
    this.adapter = adapter;
  }

  private invokeAgentReview(input: TradingCycleInput): AgentOutput | undefined {
    if (!this.adapter) return undefined;
    // Agents observe only (ADR-0003); observation runs synchronously
    // with typed contracts — never approves or executes orders.
    try {
      const agentInput: AgentInput = {
        agentId: "trading-observer",
        payload: { regime: input.regime, market: input.market },
        permissions: ["observe"],
        timestampMs: this.now(),
      };
      // Adapter contract enforced: typed output, no free-text execution trigger.
      const result = this.adapter.run(agentInput);
      return (result as { kind?: string }).kind === "structured" ? result : undefined;
    } catch {
      return undefined; // observe-only: failure must not block loop.
    }
  }

  /** Run a single integration cycle. */
  runCycle(input: TradingCycleInput): TradingCycleResult {
    if (!this.running) {
      return this.cycleError("session is not running");
    }

    // Check if kill switch is active.
    const status = this.canarySession.status;
    if (status.killSwitchActive) {
      return this.cycleError("kill switch is active");
    }

    // Step 0: Agent observation (ADR-0003 — agents observe only, never approve)
    this.invokeAgentReview(input);

    // Step 1: Classify regime.
    const regimeClassification = this.regimeClassifier.classify(input.regime);
    const regimeResult = this.regimePolicyEngine.evaluate(regimeClassification);
    this.lastRegimeClassification = regimeClassification;

    // Step 2: Handle regime emergency actions.
    if (regimeResult.changed) {
      const emergencyAction = regimeResult.policy.emergencyAction;
      if (emergencyAction === "halt") {
        this.canarySession.control("halt");
      } else if (emergencyAction === "cancel_all") {
        this.canarySession.control("cancel-all");
      } else if (emergencyAction === "reduce_only") {
        this.canarySession.control("reduce-only");
      } else if (emergencyAction === "cash_only") {
        this.canarySession.control("cash-only");
      }
    }

    // Step 3: Evaluate intents against regime policy and canary limits.
    let submittedCount = 0;
    let blockedCount = 0;
    let regimeBlockedCount = 0;

    for (let i = 0; i < input.intents.length; i++) {
      const intent = input.intents[i];
      const riskDecision = input.riskDecisions[i];

      // AC3: Regime policy blocks trading when regime doesn't allow it.
      if (!regimeResult.policy.tradingEnabled) {
        regimeBlockedCount++;
        this.recordAudit("REGIME_BLOCKED_ORDER", {
          intentId: intent.idempotencyKey,
          regime: regimeClassification.regime,
          reason: "trading disabled by regime policy",
        });
        continue;
      }

      // AC3: Strategy check is deferred — OrderIntent does not carry
      // strategyId (per ARCHITECTURE.md). The canary config's scope
      // and the regime policy's enabledStrategies are checked at the
      // opportunity/agent level, not at the order level.

      // AC2: Canary pre-check + submit.
      const { preCheck, execution } = this.canarySession.submitOrder(
        intent,
        riskDecision,
        input.market,
      );

      if (preCheck.allowed) {
        submittedCount++;

        // Record audit event for the submission.
        this.recordAudit("GAMMA_ORDER_SUBMITTED", {
          orderId: intent.idempotencyKey,
          symbol: intent.symbol,
          venue: intent.venue,
          regime: regimeClassification.regime,
          executionState: execution?.state ?? "PENDING",
        });
      } else {
        blockedCount++;
        this.recordAudit("GAMMA_ORDER_BLOCKED", {
          intentId: intent.idempotencyKey,
          reason: preCheck.reason,
          blockReason: preCheck.blockReason,
        });
      }
    }

    // Step 3.5: LoopEngine tick (CONTEXT-13 — loop engineering)
    this.recordAudit("LOOP_TICK", { cycleNumber: this.cycleCount, regime: regimeClassification.regime });

    // Step 4: Discover routes when a snapshot is provided (SP1+SP3).
    let routeDiscovery: RouteDiscoveryResult | undefined;
    if (input.snapshot !== undefined) {
      routeDiscovery = this.routeEngine.discover(input.snapshot, this.now());
      if (routeDiscovery.blockedRoutes.length > 0) {
        this.recordAudit("GAMMA_ROUTES_BLOCKED", {
          blockedCount: routeDiscovery.blockedRoutes.length,
          liveCount: routeDiscovery.liveRoutes.length,
        });
      }
    }

    // Step 5: Run learning cycle periodically.
    let learningRecommendations: LearningRecommendation[] = [];
    let learningCycleRan = false;
    this.cycleCount++;

    if (this.cycleCount % this.learningCycleInterval === 0) {
      learningRecommendations = this.learningEngine.runCycle();
      this.allRecommendations.push(...learningRecommendations);
      learningCycleRan = true;
    }

    // Record audit for the full cycle.
    this.recordAudit("GAMMA_CYCLE_COMPLETE", {
      cycleNumber: this.cycleCount,
      regime: regimeClassification.regime,
      regimeConfidence: regimeClassification.confidence,
      regimeChanged: regimeResult.changed,
      submittedCount,
      blockedCount,
      regimeBlockedCount,
      learningCycleRan,
    });

    const result: TradingCycleResult = {
      ok: true,
      regimeClassification,
      regimePolicy: regimeResult.policy,
      regimeChanged: regimeResult.changed,
      regimeChangeBlocked: regimeResult.blocked,
      regimeChangeBlockReason: regimeResult.blockReason,
      emergencyAction: regimeResult.changed
        ? regimeResult.policy.emergencyAction
        : undefined,
      submittedCount,
      blockedCount,
      regimeBlockedCount,
      learningRecommendations,
      learningCycleRan,
      routeDiscovery,
    };

    return result;
  }

  /**
   * Notify the session that an order has been resolved externally.
   * Delegates to CanarySession and records in the learning engine.
   */
  notifyOrderResolved(
    orderId: string,
    state: "FILLED" | "CANCELLED" | "REJECTED",
    pnlUsd: number = 0,
  ): void {
    this.canarySession.notifyOrderResolved(orderId, state, pnlUsd);

    // Record regime performance.
    if (state === "FILLED") {
      this.regimePolicyEngine.recordTrade(pnlUsd);
    }

    // Record audit event.
    this.recordAudit("GAMMA_ORDER_RESOLVED", {
      orderId,
      state,
      pnlUsd,
    });
  }

  /**
   * Poll the execution engine and return order events.
   */
  pollExecution() {
    return this.canarySession.pollExecution();
  }

  /**
   * Set reconciliation status. Delegates to CanarySession.
   */
  setReconciliationStatus(unresolved: boolean): void {
    this.canarySession.setReconciliationStatus(unresolved);
  }

  /**
   * Enter/exit defensive CANCEL_ONLY_MODE for a WebSocket drop with an active
   * partial fill. Delegates to CanarySession (does not trigger the auto kill
   * switch). Cleared by a clean reconciliation.
   */
  setDefensiveCancelOnly(active: boolean): void {
    this.canarySession.setDefensiveCancelOnly(active);
  }

  /**
   * Get the current canary status.
   */
  get status() {
    return this.canarySession.status;
  }

  /**
   * Current canary execution state (orders, exposure, capital, PnL) so the
   * orchestrator can feed live risk inputs to the RiskEngine (GAP3).
   */
  get executionState() {
    return this.canarySession.executionState;
  }

  /**
   * Whether the session is running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the learning engine (for direct access to journal and recommendations).
   */
  get learning(): LearningEngine {
    return this.learningEngine;
  }

  /**
   * Get the audit reconstructor.
   */
  get reconstructor(): AuditReconstructor {
    return this.auditReconstructor;
  }

  /**
   * Get the last regime classification.
   */
  get regimeClassification(): RegimeClassification | null {
    return this.lastRegimeClassification;
  }

  /**
   * Get the current regime policy.
   */
  get regimePolicy(): RegimePolicy {
    return this.regimePolicyEngine.policy;
  }

  /**
   * Get the trade journal from the learning engine.
   */
  get journal(): TradeJournal {
    return this.learningEngine.journal;
  }

  // ── Session Summary ──────────────────────────────────────────────

  /**
   * Produce a complete session summary with audit trail, reports,
   * reconstructions, and exports.
   *
   * AC1: All subsystems integrated — summary includes data from every subsystem.
   * AC2: Session completes within hard limits — summary reports capital and limits.
   * AC3: Every decision auditable — summary includes audit event count and reconstructions.
   * AC4: canary exit criterion — summary reports bounded capital, preserved limits, etc.
   */
  getSessionSummary(): TradingSessionSummary {
    // Build audit reconstructions from journal entries and audit events.
    // (In a real system, audit events would come from the AuditLog.
    //  Here we feed them from the reconstructor's stored events.)
    const reconstructions = this.auditReconstructor.reconstructAll();

    // Generate reports.
    const journalEntries = this.learningEngine.journal.getEntries();
    const reportGenerator = new ReportGenerator(
      journalEntries,
      reconstructions,
      this.now,
    );
    const dailyReport = reportGenerator.generateDailyReport(this.now());
    const weeklyReport = reportGenerator.generateWeeklyReport(this.now());

    // Export reports.
    const dailyJson = this.auditExporter.exportReport(dailyReport, {
      format: "json",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });
    const dailyCsv = this.auditExporter.exportReport(dailyReport, {
      format: "csv",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });
    const dailyTxt = this.auditExporter.exportReport(dailyReport, {
      format: "txt",
      includeEntries: true,
      includeReasonCodes: true,
      includeTimeline: false,
    });

    const status = this.canarySession.status;

    return {
      completedNormally: this.running === false && !status.killSwitchActive,
      canaryStatus: {
        running: status.running,
        mode: status.mode,
        killSwitchActive: status.killSwitchActive,
        capitalDeployedUsd: status.capitalDeployedUsd,
        capitalRemainingUsd: status.capitalRemainingUsd,
        dailyPnlUsd: status.dailyPnlUsd,
        weeklyPnlUsd: status.weeklyPnlUsd,
        orphanOrderCount: status.orphanOrderCount,
        reconciliationUnresolved: status.reconciliationUnresolved,
      },
      regimeClassification: this.lastRegimeClassification ?? undefined,
      regimeChangeHistory: this.regimePolicyEngine.history,
      regimePerformance: this.regimePolicyEngine.performanceTracker.getAll(),
      journalEntryCount: journalEntries.length,
      dailyReport,
      weeklyReport,
      reconstructions,
      exportedReports: { dailyJson, dailyCsv, dailyTxt },
      learningRecommendations: this.allRecommendations,
      activePromotions: this.learningEngine.promotionPipeline.getActivePromotions(),
      allPromotions: this.learningEngine.promotionPipeline.getAllRecords(),
      auditEventCount: this.auditReconstructor.auditEventCount,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /** Shared error-return shape for runCycle early exits (S4). */
  private cycleError(error: string): TradingCycleResult {
    return {
      ok: false,
      error,
      regimeChanged: false,
      regimeChangeBlocked: false,
      submittedCount: 0,
      blockedCount: 0,
      regimeBlockedCount: 0,
      learningRecommendations: [],
      learningCycleRan: false,
    };
  }

  // ── Audit Integration ─────────────────────────────────────────────

  /**
   * Record an audit event in the reconstructor.
   * In a real system, this would flow through the AuditLog.
   */
  private recordAudit(
    eventType: string,
    data: Record<string, unknown>,
  ): void {
    this.auditSequence++;
    this.auditReconstructor.addAuditEvent({
      eventId: `trading-${eventType}-${this.now()}`,
      sequence: this.auditSequence,
      timestampMs: this.now(),
      action: "STATE_TRANSITION",
      actor: "trading-session",
      state: this.canarySession.status.killSwitchActive
        ? "HALT"
        : this.running
          ? "EXECUTE_ORDER"
          : "IDLE",
      data: {
        eventType,
        cycleNumber: this.cycleCount,
        ...data,
      },
      reasonCodes: ["TRANSITION_ALLOWED"],
    });
  }
}
