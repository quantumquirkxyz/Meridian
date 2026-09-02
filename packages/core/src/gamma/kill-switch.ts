/**
 * KillSwitch: manual and automatic kill switch for the Live Canary
 * session (Gamma.1, issue #34).
 *
 * Acceptance criteria (AC3):
 *   - Kill switch (manual and automatic) halts live activity.
 *   - Automatic triggers: orphan orders, reconciliation mismatch,
 *     daily/weekly loss limits, order count limits.
 *   - Cooldown between automatic activations prevents rapid cycling.
 *
 * The kill switch is deterministic — no LLM, no I/O. It evaluates
 * canary state against configured thresholds and decides whether to
 * halt the system.
 */

import type {
  CanaryKillSwitchConfig,
} from "@agenttrading/contracts";

// ── Trigger Types ────────────────────────────────────────────────────

export const KILL_SWITCH_TRIGGERS = [
  "manual",
  "daily-loss",
  "weekly-loss",
  "orders-per-day",
  "orphan-orders",
  "reconciliation-mismatch",
] as const;

export type KillSwitchTrigger = (typeof KILL_SWITCH_TRIGGERS)[number];

// ── Input ────────────────────────────────────────────────────────────

/**
 * Current canary state that the kill switch evaluates.
 */
export interface KillSwitchInput {
  /** Whether the kill switch has already been activated (manual or auto). */
  alreadyActive: boolean;
  /** Current daily loss (USD). Negative = profit. */
  dailyLossUsd: number;
  /** Current weekly loss (USD). Negative = profit. */
  weeklyLossUsd: number;
  /** Number of orders placed today. */
  ordersToday: number;
  /** Number of orphan orders detected. */
  orphanOrderCount: number;
  /** Whether reconciliation is currently unresolved. */
  reconciliationUnresolved: boolean;
  /** Current timestamp (Unix ms). */
  nowMs: number;
  /** Timestamp of the last automatic kill switch activation (ms). */
  lastAutoKillAtMs?: number;
}

// ── Result ───────────────────────────────────────────────────────────

export interface KillSwitchResult {
  /** Whether the kill switch should be activated. */
  shouldHalt: boolean;
  /** What triggered the halt, if any. */
  trigger?: KillSwitchTrigger;
  /** Human-readable explanation. */
  reason: string;
  /** Whether the activation is manual (operator-initiated). */
  manual: boolean;
}

// ── Engine ───────────────────────────────────────────────────────────

/**
 * KillSwitch: evaluates canary state against configured thresholds
 * and decides whether to halt the system.
 *
 * The engine is stateless — all context is passed in via KillSwitchInput.
 * The caller (canary session) is responsible for tracking cumulative
 * state between evaluations.
 */
export class KillSwitch {
  private readonly config: CanaryKillSwitchConfig;

  constructor(config: CanaryKillSwitchConfig) {
    this.config = { ...config };
  }

  /**
   * Manual halt: unconditionally halts the system.
   * Always succeeds unless already active.
   */
  manualHalt(alreadyActive: boolean): KillSwitchResult {
    if (alreadyActive) {
      return {
        shouldHalt: false,
        reason: "kill switch already active",
        manual: true,
      };
    }
    return {
      shouldHalt: true,
      trigger: "manual",
      reason: "operator activated kill switch",
      manual: true,
    };
  }

  /**
   * Automatic evaluation: checks all configured auto-halt triggers
   * against the current canary state. Returns the first trigger that
   * fires (priority order: reconciliation, orphans, daily loss,
   * weekly loss, orders per day).
   */
  evaluate(input: KillSwitchInput): KillSwitchResult {
    if (input.alreadyActive) {
      return {
        shouldHalt: false,
        reason: "kill switch already active",
        manual: false,
      };
    }

    // Check cooldown for automatic triggers.
    if (
      this.config.cooldownMs !== undefined &&
      input.lastAutoKillAtMs !== undefined
    ) {
      const elapsed = input.nowMs - input.lastAutoKillAtMs;
      if (elapsed < this.config.cooldownMs) {
        return {
          shouldHalt: false,
          reason: `cooldown active (${elapsed}ms < ${this.config.cooldownMs}ms)`,
          manual: false,
        };
      }
    }

    // Priority 1: Reconciliation mismatch (fail closed).
    if (
      this.config.autoHaltOnReconciliationMismatch &&
      input.reconciliationUnresolved
    ) {
      return {
        shouldHalt: true,
        trigger: "reconciliation-mismatch",
        reason: "reconciliation unresolved; halting per canary policy",
        manual: false,
      };
    }

    // Priority 2: Orphan orders (fail closed).
    if (this.config.autoHaltOnOrphans && input.orphanOrderCount > 0) {
      return {
        shouldHalt: true,
        trigger: "orphan-orders",
        reason: `${input.orphanOrderCount} orphan order(s) detected; halting per canary policy`,
        manual: false,
      };
    }

    // Priority 3: Daily loss limit.
    if (
      this.config.autoHaltDailyLossUsd !== undefined &&
      input.dailyLossUsd >= this.config.autoHaltDailyLossUsd
    ) {
      return {
        shouldHalt: true,
        trigger: "daily-loss",
        reason: `daily loss ${input.dailyLossUsd} >= auto-halt threshold ${this.config.autoHaltDailyLossUsd}`,
        manual: false,
      };
    }

    // Priority 4: Weekly loss limit.
    if (
      this.config.autoHaltWeeklyLossUsd !== undefined &&
      input.weeklyLossUsd >= this.config.autoHaltWeeklyLossUsd
    ) {
      return {
        shouldHalt: true,
        trigger: "weekly-loss",
        reason: `weekly loss ${input.weeklyLossUsd} >= auto-halt threshold ${this.config.autoHaltWeeklyLossUsd}`,
        manual: false,
      };
    }

    // Priority 5: Orders per day limit.
    if (
      this.config.autoHaltOrdersPerDay !== undefined &&
      input.ordersToday >= this.config.autoHaltOrdersPerDay
    ) {
      return {
        shouldHalt: true,
        trigger: "orders-per-day",
        reason: `orders today ${input.ordersToday} >= auto-halt threshold ${this.config.autoHaltOrdersPerDay}`,
        manual: false,
      };
    }

    return {
      shouldHalt: false,
      reason: "all auto-halt thresholds within bounds",
      manual: false,
    };
  }
}
