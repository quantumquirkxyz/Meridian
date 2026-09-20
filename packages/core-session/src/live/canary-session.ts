/**
 * CanarySession: the deterministic Live Canary trading session
 * (Issue #34). Orchestrates live canary trading with:
 *
 * - Bounded capital bucket and hard limits per trade/day/venue/token/chain
 * - Manual and automatic kill switch
 * - Emergency modes (cancel-all, reduce-only, cash-only) from TUI
 * - No orphan orders and no limit violations
 * - No automatic scaling
 * - Read/trading key separation (enforced at config level)
 * - Withdrawals disabled (enforced at config level)
 *
 * The session is deterministic — no LLM, no I/O. All state changes
 * flow through the control port, which is the only way the TUI or
 * operator can interact with the canary.
 *
 * Acceptance criteria:
 *   AC1: Canary config enforces bounded capital and hard limits per
 *        trade/day/venue/token/chain.
 *   AC2: Read and trading keys are separate; withdrawals disabled.
 *   AC3: Kill switch (manual and automatic) halts live activity.
 *   AC4: No orphan orders and no limit violations in a live canary session.
 */

import {
  type CanaryControlCommand,
  type CanaryControlResult,
  type CanaryControlStatus,
  type SystemMode,
} from "@agenttrading/contracts";
import {
  type CanaryConfig,
  DEFAULT_CANARY_CONFIG,
} from "@agenttrading/contracts";
import {
  type OrderIntent,
  type OrderRouteAck,
  type OrderRouter,
  type RiskDecision,
} from "@agenttrading/contracts";
import { type FillParams, type AuditAvailability, DEFAULT_AUDIT_AVAILABILITY } from "@agenttrading/contracts";
import { evaluateAuditStaleness } from "@agenttrading/core-session";
import { type AuditLog } from "@agenttrading/core-stategraph";
import {
  KillSwitch,
  type KillSwitchInput,
  type KillSwitchTrigger,
} from "@agenttrading/core-execution";
import {
  LiveExecutionEngine,
  type CanaryExecutionState,
  type CanaryPreCheckResult,
} from "@agenttrading/core-execution";
import {
  DAILY_LOSS_WINDOW_MS,
  WEEKLY_LOSS_WINDOW_MS,
  isWithinRollingWindow,
  trailingWindowLoss,
  type RealizedPnlEvent,
} from "@agenttrading/core-risk";
import {
  type OrderSnapshot,
} from "@agenttrading/core-execution";
import { type TradeJournal } from "@agenttrading/core-session";

// ── Types ────────────────────────────────────────────────────────────

/** Day key: a YYYY-MM-DD string representing a calendar day. */
type DayKey = string & { readonly __brand: "DayKey" };
/** Week key: a YYYY-MM-DD string representing the start of an ISO week. */
type WeekKey = string & { readonly __brand: "WeekKey" };

function toDayKey(isoDate: string): DayKey {
  return isoDate.slice(0, 10) as DayKey;
}

function toWeekKey(nowMs: number): WeekKey {
  const d = new Date(nowMs);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10) as WeekKey;
}

export interface CanaryOrderRecord {
  orderId: string;
  intent: OrderIntent;
  riskDecision?: RiskDecision;
    execution?: OrderSnapshot;
  preCheck?: CanaryPreCheckResult;
  submittedAtMs: number;
  symbol: string;
  venue: string;
  chain: string;
  side: "BUY" | "SELL";
  notionalUsd: number;
  state: string;
}

export interface CanarySessionOptions {
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Audit log for recording canary events. */
  audit?: AuditLog;
  /** Custom canary config; defaults to DEFAULT_CANARY_CONFIG. */
  config?: CanaryConfig;
  /** Trade journal for automatic outcome recording. */
  journal?: TradeJournal;
  /** Audit availability checker. When provided, audit unavailability blocks trading (AC4). */
  auditAvailability?: AuditAvailability;
}

// ── Session ──────────────────────────────────────────────────────────

/**
 * CanarySession: the deterministic Live Canary trading session.
 *
 * Usage:
 * ```ts
 * const session = new CanarySession({ config: myConfig });
 * session.start();
 * const result = await session.runCycle(scenario);
 * session.control("halt");
 * ```
 */
export class CanarySession {
  private readonly config: CanaryConfig;
  private readonly now: () => number;
  private readonly audit?: AuditLog;
  private readonly journal?: TradeJournal;
  private readonly auditAvailability: AuditAvailability;
  private readonly killSwitch: KillSwitch;
  private readonly execution: LiveExecutionEngine;

  private running = false;
  private paused = false;
  private killSwitchActive = false;
  private lastAutoKillAtMs?: number;
  private autoKillTrigger?: string;

  // Cumulative state
  private ordersToday: CanaryOrderRecord[] = [];
  private ordersThisWeek: CanaryOrderRecord[] = [];
  private openOrders: CanaryOrderRecord[] = [];
  private exposurePerToken: Record<string, number> = {};
  private exposurePerVenue: Record<string, number> = {};
  private exposurePerChain: Record<string, number> = {};
  private capitalDeployedUsd = 0;
  private orphanOrders: CanaryOrderRecord[] = [];
  private reconciliationUnresolved = false;
  private currentMode: SystemMode = "NORMAL";

  // Day/week tracking
  private currentDay: DayKey = "" as DayKey;
  private currentWeek: WeekKey = "" as WeekKey;

  // Rolling loss tracking (ADR-0014, ticket #130): realized fills stamped with
  // their resolution time feed DAILY_LOSS_WINDOW_MS / WEEKLY_LOSS_WINDOW_MS so
  // rules 2-3 roll over 24h/7d instead of resetting at a calendar boundary.
  private realizedPnlEvents: RealizedPnlEvent[] = [];

  constructor(options: CanarySessionOptions = {}) {
    this.config = options.config ?? DEFAULT_CANARY_CONFIG;
    this.now = options.now ?? (() => Date.now());
    this.audit = options.audit;
    this.journal = options.journal;
    this.auditAvailability = { ...(options.auditAvailability ?? DEFAULT_AUDIT_AVAILABILITY) };
    this.killSwitch = new KillSwitch(this.config.killSwitch);
    this.execution = new LiveExecutionEngine(this.config);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** Current canary status. */
  get status(): CanaryControlStatus {
    const nowMs = this.now();
    this.resetCountersIfNeeded(nowMs);

    return {
      running: this.running,
      mode: this.currentMode,
      state: this.killSwitchActive
        ? "HALT"
        : this.paused
          ? "IDLE"
          : this.running
            ? "EXECUTE_ORDER"
            : "IDLE",
      killSwitchActive: this.killSwitchActive,
      openOrders: this.openOrders.length,
      ordersToday: this.ordersToday.length,
      ordersThisWeek: this.ordersThisWeek.length,
      capitalDeployedUsd: this.capitalDeployedUsd,
      capitalRemainingUsd:
        this.config.capitalLimits.maxCapitalUsd - this.capitalDeployedUsd,
      dailyPnlUsd: this.rollingDailyPnlUsd(nowMs),
      weeklyPnlUsd: this.rollingWeeklyPnlUsd(nowMs),
      orphanOrderCount: this.orphanOrders.length,
      reconciliationUnresolved: this.reconciliationUnresolved,
      autoKillTrigger: this.autoKillTrigger,
      paused: this.paused,
    };
  }

  /**
   * Process a control command from the TUI.
   * Returns the full status after the command.
   */
  control(command: CanaryControlCommand): CanaryControlResult {
    const statusBefore = this.status;

    switch (command) {
      case "start":
        return this.handleStart(statusBefore);
      case "stop":
        return this.handleStop(statusBefore);
      case "pause":
        return this.handlePause(statusBefore);
      case "resume":
        return this.handleResume(statusBefore);
      case "cancel-all":
        return this.handleCancelAll(statusBefore);
      case "cash-only":
        return this.handleMode("CASH_ONLY", statusBefore);
      case "reduce-only":
        return this.handleMode("REDUCE_ONLY", statusBefore);
      case "halt":
        return this.handleHalt(statusBefore);
      default:
        return {
          ...statusBefore,
          command,
          ok: false,
          error: `unknown command: ${command}`,
        };
    }
  }

  /**
   * Late-wire an OrderRouter into the execution engine (ADR-0011).
   * When attached, the engine places real orders through the router;
   * otherwise it simulates (harness/tests).
   */
  setOrderRouter(orderRouter?: OrderRouter): void {
    this.execution.setOrderRouter(orderRouter);
  }

  /** Whether a live OrderRouter is attached (ADR-0011 seam active). */
  get hasOrderRouter(): boolean {
    return this.execution.hasOrderRouter;
  }

  /**
   * Pre-check an order intent against canary limits.
   */
  preCheckIntent(intent: OrderIntent): CanaryPreCheckResult {
    if (this.killSwitchActive) {
      return {
        allowed: false,
        reason: "kill switch is active; no orders allowed",
      };
    }
    if (this.paused) {
      return {
        allowed: false,
        reason: "canary is paused; no orders allowed",
      };
    }
    // AC4: Audit unavailability blocks trading.
    const auditBlockingReason = this.getAuditBlockingReason();
    if (auditBlockingReason !== null) {
      return {
        allowed: false,
        reason: auditBlockingReason,
      };
    }
    return this.execution.preCheck(intent, this.buildExecutionState());
  }

  /**
   * Place a real order through the execution engine's OrderRouter
   * (ADR-0011). The engine enforces the canary pre-check and requires the
   * Risk Engine's APPROVE decision before sending (fail closed, ADR-0003);
   * without a router it falls back to simulation (harness/tests).
   */
  placeLiveOrder(
    intent: OrderIntent,
    preCheck: CanaryPreCheckResult,
    riskDecision: RiskDecision,
  ): Promise<OrderRouteAck> {
    return this.execution.placeLiveOrder(intent, preCheck, riskDecision);
  }

  /**
   * Submit an order intent through the canary session.
   * Returns the pre-check result and optional execution snapshot.
   */
  submitOrder(
    intent: OrderIntent,
    riskDecision: RiskDecision,
    market: { bid: number; ask: number; mid: number; liquidityUsd: number },
    submittedAtMs?: number,
  ): {
    preCheck: CanaryPreCheckResult;
  execution?: OrderSnapshot;
  } {
    const ts = submittedAtMs ?? this.now();

    // Fail-closed: block when kill switch is active or paused.
    if (this.killSwitchActive) {
      return {
        preCheck: {
          allowed: false,
          reason: "kill switch is active; no orders allowed",
        },
      };
    }
    if (this.paused) {
      return {
        preCheck: {
          allowed: false,
          reason: "canary is paused; no orders allowed",
        },
      };
    }
    // AC4: Audit unavailability blocks trading.
    const auditBlockingReason = this.getAuditBlockingReason();
    if (auditBlockingReason !== null) {
      return {
        preCheck: {
          allowed: false,
          reason: auditBlockingReason,
        },
      };
    }

    const preCheck = this.execution.preCheck(intent, this.buildExecutionState());

    if (!preCheck.allowed) {
      this.recordAudit("ORDER_REJECTED", {
        orderId: intent.idempotencyKey,
        reason: preCheck.reason,
        blockReason: preCheck.blockReason,
      });
      return { preCheck };
    }

    // Enforce withdrawal disabled at session level.
    if (!this.config.apiKeys.withdrawalsDisabled) {
      return {
        preCheck: {
          allowed: false,
          reason: "withdrawals not disabled; canary requires withdrawals disabled on trading key",
        },
      };
    }

    // Check strategy/venue allowlists.
    if (!this.config.scope.allowedVenues.includes(intent.venue)) {
      return {
        preCheck: {
          allowed: false,
          reason: `venue ${intent.venue} is not in allowed venues: ${this.config.scope.allowedVenues.join(", ")}`,
        },
      };
    }

    if (!this.config.scope.allowedTokens.includes(intent.symbol)) {
      return {
        preCheck: {
          allowed: false,
          reason: `token ${intent.symbol} is not in allowed tokens: ${this.config.scope.allowedTokens.join(", ")}`,
        },
      };
    }

    // Submit through the live execution engine.
    const notionalUsd = (preCheck.approvedQuantity ?? intent.quantity) * intent.price;
    const execution = this.execution.submit(
      {
        intent,
        riskDecision,
        market,
        submittedAtMs: ts,
        slippageBps: this.config.maxSlippageBps,
        feeBps: 2,
      },
      preCheck,
    );

    // Track the order.
    const record: CanaryOrderRecord = {
      orderId: intent.idempotencyKey,
      intent,
      riskDecision,
      execution,
      preCheck,
      submittedAtMs: ts,
      symbol: intent.symbol,
      venue: intent.venue,
      chain: intent.venue,
      side: intent.side,
      notionalUsd,
      state: execution.state,
    };

    this.openOrders.push(record);
    this.ordersToday.push(record);
    this.ordersThisWeek.push(record);
    this.capitalDeployedUsd += notionalUsd;

    // Update exposure tracking.
    this.exposurePerToken[intent.symbol] =
      (this.exposurePerToken[intent.symbol] ?? 0) + notionalUsd;
    this.exposurePerVenue[intent.venue] =
      (this.exposurePerVenue[intent.venue] ?? 0) + notionalUsd;
    // engine preCheck keys chain exposure by venue (DEX venue == chain).
    this.exposurePerChain[intent.venue] =
      (this.exposurePerChain[intent.venue] ?? 0) + notionalUsd;

    this.recordAudit("ORDER_SUBMITTED", {
      orderId: intent.idempotencyKey,
      symbol: intent.symbol,
      venue: intent.venue,
      notionalUsd,
      preCheckReason: preCheck.reason,
    });

    // Run automatic kill switch check after every order.
    this.evaluateAutoKillSwitch();

    return { preCheck, execution };
  }

  /**
   * Notify the session that an order has been filled, cancelled, or
   * rejected externally (e.g. by the exchange connector).
   */
  notifyOrderResolved(
    orderId: string,
    state: "FILLED" | "CANCELLED" | "REJECTED",
    pnlUsd: number = 0,
  ): void {
    const idx = this.openOrders.findIndex((o) => o.orderId === orderId);
    if (idx === -1) {
      // Orphan: we don't have this order in our tracking.
      this.orphanOrders.push({
        orderId,
        intent: {} as OrderIntent,
        submittedAtMs: this.now(),
        symbol: "",
        venue: "",
        chain: "",
        side: "BUY",
        notionalUsd: 0,
        state: "UNKNOWN",
      });
      this.recordAudit("ORPHAN_DETECTED", { orderId, state });
      this.evaluateAutoKillSwitch();
      return;
    }

    const record = this.openOrders[idx];
    this.openOrders.splice(idx, 1);
    this.capitalDeployedUsd -= record.notionalUsd;

    // Update exposure.
    this.exposurePerToken[record.symbol] =
      (this.exposurePerToken[record.symbol] ?? 0) - record.notionalUsd;
    this.exposurePerVenue[record.venue] =
      (this.exposurePerVenue[record.venue] ?? 0) - record.notionalUsd;
    this.exposurePerChain[record.venue] =
      (this.exposurePerChain[record.venue] ?? 0) - record.notionalUsd;

    if (state === "FILLED") {
      // Rolling: record the realized PnL with a timestamp so rules 2-3 use a
      // trailing 24h/7d window (ADR-0014) rather than a calendar reset.
      const atMs = this.now();
      this.realizedPnlEvents.push({ pnlUsd, atMs });
      // Prune events older than the widest window so the buffer stays bounded.
      const cutoff = atMs - WEEKLY_LOSS_WINDOW_MS;
      this.realizedPnlEvents = this.realizedPnlEvents.filter(
        (e) => e.atMs > cutoff,
      );

      // Auto-record filled trade to journal (AC1).
      if (this.journal !== undefined) {
        const intent = record.intent;
        const exitPrice = intent.price; // Approximate; real exit price from fill data.
        const fillParams: FillParams = {
          tradeId: orderId,
          strategyId: "canary",
          regime: this.currentMode,
          venue: record.venue,
          symbol: record.symbol,
          side: record.side,
          entryPrice: intent.price,
          exitPrice: intent.price + (record.side === "BUY" ? pnlUsd / intent.quantity : -pnlUsd / intent.quantity),
          filledQuantity: intent.quantity,
          feesUsd: 0,
          enteredAtMs: record.submittedAtMs,
          exitedAtMs: this.now(),
        };
        this.journal.recordFill(fillParams);
      }
    }

    this.recordAudit("ORDER_RESOLVED", {
      orderId,
      state,
      pnlUsd,
      symbol: record.symbol,
      venue: record.venue,
    });

    // Run automatic kill switch check after every resolution.
    this.evaluateAutoKillSwitch();
  }

  /**
   * Poll the execution engine and return any order events.
   */
  pollExecution() {
    const nowMs = this.now();
    return this.execution.poll(nowMs);
  }

  /**
   * Set reconciliation status. Called by the reconciliation engine.
   */
  setReconciliationStatus(unresolved: boolean): void {
    this.reconciliationUnresolved = unresolved;
    if (unresolved) {
      this.recordAudit("RECONCILIATION_UNRESOLVED", {});
      this.evaluateAutoKillSwitch();
    }
  }

  /**
   * Defensive CANCEL_ONLY_MODE for a WebSocket drop with an active partial fill
   * (CONTEXT.md §Reconciliation). Unlike setReconciliationStatus(true) this does
   * NOT evaluate the reconciliation-mismatch auto-kill-switch (which would HALT);
   * it blocks new positions and marks reconciliation unresolved so the derived
   * mode is CANCEL_ONLY, and only returns to NORMAL after an exact reconciliation
   * (setReconciliationStatus(false) from a clean reconcile clears it).
   */
  setDefensiveCancelOnly(active: boolean): void {
    this.reconciliationUnresolved = active;
    if (active) {
      this.recordAudit("CANCEL_ONLY_ACTIVATED", {
        reason: "ws-drop-partial-fill",
      });
    } else {
      this.recordAudit("CANCEL_ONLY_RESOLVED", {});
      this.currentMode = "NORMAL";
    }
  }

  /**
   * Reset daily counters (called automatically when the day changes).
   */
  private resetCountersIfNeeded(nowMs: number): void {
    const day = toDayKey(new Date(nowMs).toISOString());
    if (day !== this.currentDay) {
      this.currentDay = day;
      this.ordersToday = [];
    }

    const week = toWeekKey(nowMs);
    if (week !== this.currentWeek) {
      this.currentWeek = week;
      this.ordersThisWeek = [];
    }
  }

  /** Loss (USD) realized inside the trailing window; canonical rollover. */
  private rollingLossUsd(nowMs: number, windowMs: number): number {
    return trailingWindowLoss(this.realizedPnlEvents, nowMs, windowMs);
  }

  /**
   * Signed net PnL (USD) realized inside the trailing daily window ending at
   * `nowMs`. Negative = loss. Uses its own signed loop because the floored
   * loss figure from `trailingWindowLoss` cannot recover a profitable net;
   * window membership shares `isWithinRollingWindow`.
   */
  private rollingDailyPnlUsd(nowMs: number): number {
    return this.netPnlInWindow(nowMs, DAILY_LOSS_WINDOW_MS);
  }

  /** Signed net PnL (USD) realized inside the trailing 7d window. Negative = loss. */
  private rollingWeeklyPnlUsd(nowMs: number): number {
    return this.netPnlInWindow(nowMs, WEEKLY_LOSS_WINDOW_MS);
  }

  /** Signed net PnL (USD) realized inside a trailing window. Negative = loss. */
  private netPnlInWindow(nowMs: number, windowMs: number): number {
    let net = 0;
    for (const event of this.realizedPnlEvents) {
      if (isWithinRollingWindow(event.atMs, nowMs, windowMs)) net += event.pnlUsd;
    }
    return net;
  }

  // ── Command Handlers ─────────────────────────────────────────────────

  private handleStart(
    statusBefore: CanaryControlStatus,
  ): CanaryControlResult {
    if (this.killSwitchActive) {
      return {
        ...statusBefore,
        command: "start",
        ok: false,
        error: "cannot start: kill switch is active",
      };
    }
    this.running = true;
    this.paused = false;
    this.currentMode = "NORMAL";
    this.recordAudit("CANARY_STARTED", {});
    return { ...this.status, command: "start", ok: true };
  }

  private handleStop(statusBefore: CanaryControlStatus): CanaryControlResult {
    this.running = false;
    this.paused = false;
    this.cancelAllOpenOrders();
    this.currentMode = "HALT";
    this.recordAudit("CANARY_STOPPED", {});
    return { ...this.status, command: "stop", ok: true };
  }

  private handlePause(statusBefore: CanaryControlStatus): CanaryControlResult {
    if (!this.running) {
      return {
        ...statusBefore,
        command: "pause",
        ok: false,
        error: "cannot pause: canary is not running",
      };
    }
    this.paused = true;
    this.currentMode = "OBSERVE_ONLY";
    this.recordAudit("CANARY_PAUSED", {});
    return { ...this.status, command: "pause", ok: true };
  }

  private handleResume(statusBefore: CanaryControlStatus): CanaryControlResult {
    if (!this.paused) {
      return {
        ...statusBefore,
        command: "resume",
        ok: false,
        error: "cannot resume: canary is not paused",
      };
    }
    if (this.killSwitchActive) {
      return {
        ...statusBefore,
        command: "resume",
        ok: false,
        error: "cannot resume: kill switch is active",
      };
    }
    this.paused = false;
    this.currentMode = "NORMAL";
    this.recordAudit("CANARY_RESUMED", {});
    return { ...this.status, command: "resume", ok: true };
  }

  private handleCancelAll(
    statusBefore: CanaryControlStatus,
  ): CanaryControlResult {
    this.cancelAllOpenOrders();
    this.recordAudit("CANCEL_ALL", {});
    return { ...this.status, command: "cancel-all", ok: true };
  }

  private handleMode(
    mode: SystemMode,
    statusBefore: CanaryControlStatus,
  ): CanaryControlResult {
    this.currentMode = mode;
    this.recordAudit("MODE_CHANGED", { mode });
    return { ...this.status, command: mode === "CASH_ONLY" ? "cash-only" : "reduce-only", ok: true };
  }

  private handleHalt(statusBefore: CanaryControlStatus): CanaryControlResult {
    const result = this.killSwitch.manualHalt(this.killSwitchActive);
    if (result.shouldHalt) {
      this.killSwitchActive = true;
      this.running = false;
      this.paused = false;
      this.currentMode = "HALT";
      this.cancelAllOpenOrders();
      this.recordAudit("KILL_SWITCH_ACTIVATED", {
        trigger: "manual",
        reason: result.reason,
      });
    }
    return { ...this.status, command: "halt", ok: result.shouldHalt };
  }

  // ── Automatic Kill Switch ────────────────────────────────────────────

  private evaluateAutoKillSwitch(): void {
    if (this.killSwitchActive) return;

    const now = this.now();
    const input: KillSwitchInput = {
      alreadyActive: this.killSwitchActive,
      dailyLossUsd: this.rollingLossUsd(now, DAILY_LOSS_WINDOW_MS),
      weeklyLossUsd: this.rollingLossUsd(now, WEEKLY_LOSS_WINDOW_MS),
      ordersToday: this.ordersToday.length,
      orphanOrderCount: this.orphanOrders.length,
      reconciliationUnresolved: this.reconciliationUnresolved,
      nowMs: now,
      lastAutoKillAtMs: this.lastAutoKillAtMs,
    };

    const result = this.killSwitch.evaluate(input);

    if (result.shouldHalt) {
      this.killSwitchActive = true;
      this.running = false;
      this.paused = false;
      this.currentMode = "HALT";
      this.autoKillTrigger = result.trigger;
      this.lastAutoKillAtMs = this.now();
      this.cancelAllOpenOrders();
      this.recordAudit("KILL_SWITCH_ACTIVATED", {
        trigger: result.trigger,
        reason: result.reason,
        automatic: true,
      });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Current execution state snapshot (orders, exposure, capital, PnL).
   * Lets the orchestrator feed live exposure/loss inputs to the RiskEngine
   * evaluation (GAP3: rules 4-6 are fed from tracked state).
   */
  get executionState(): CanaryExecutionState {
    return this.buildExecutionState();
  }

  private buildExecutionState(): CanaryExecutionState {
    const nowMs = this.now();
    this.resetCountersIfNeeded(nowMs);
    return {
      ordersToday: this.ordersToday,
      ordersThisWeek: this.ordersThisWeek,
      openOrders: this.openOrders,
      exposurePerToken: this.exposurePerToken,
      exposurePerVenue: this.exposurePerVenue,
      exposurePerChain: this.exposurePerChain,
      capitalDeployedUsd: this.capitalDeployedUsd,
      dailyPnlUsd: this.rollingDailyPnlUsd(nowMs),
      weeklyPnlUsd: this.rollingWeeklyPnlUsd(nowMs),
    };
  }

  private cancelAllOpenOrders(): void {
    this.execution.cancelAll(this.now());
    for (const record of this.openOrders) {
      this.capitalDeployedUsd -= record.notionalUsd;
      this.exposurePerToken[record.symbol] =
        (this.exposurePerToken[record.symbol] ?? 0) - record.notionalUsd;
      this.exposurePerVenue[record.venue] =
        (this.exposurePerVenue[record.venue] ?? 0) - record.notionalUsd;
      this.exposurePerChain[record.venue] =
        (this.exposurePerChain[record.venue] ?? 0) - record.notionalUsd;
    }
    this.openOrders = [];
  }

  // ── AC4: Audit Availability ──────────────────────────────────────

  /**
   * Check if audit unavailability should block trading.
   * Returns the blocking reason if audit is unavailable, or null if trading
   * is allowed.
   *
   * AC4: Audit unavailability blocks trading (invariant).
   * Uses the shared staleness evaluation (S2 fix).
   */
  private getAuditBlockingReason(): string | null {
    const result = evaluateAuditStaleness(this.auditAvailability, this.now());
    if (result.available) return null;
    return result.error ?? "audit unavailable";
  }

  /**
   * Update the audit availability status. Called by the infra layer
   * when the audit subsystem state changes.
   */
  updateAuditAvailability(availability: AuditAvailability): void {
    this.auditAvailability.available = availability.available;
    this.auditAvailability.lastWriteAtMs = availability.lastWriteAtMs;
    this.auditAvailability.maxStaleMs = availability.maxStaleMs;
    this.auditAvailability.error = availability.error;
  }

  private recordAudit(
    action: string,
    data: Record<string, unknown>,
  ): void {
    this.audit?.record({
      eventId: `canary-${action}-${this.now()}`,
      timestampMs: this.now(),
      action: "STATE_TRANSITION",
      actor: "canary-session",
      state: this.killSwitchActive
        ? "HALT"
        : this.running
          ? "EXECUTE_ORDER"
          : "IDLE",
      reasonCodes: ["TRANSITION_ALLOWED"],
      data: { action, ...data },
    });
  }
}
