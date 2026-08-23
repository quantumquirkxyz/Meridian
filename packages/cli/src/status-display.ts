/**
 * StatusDisplay: real-time console output for each trading cycle.
 *
 * Shows mode, regime, PnL, open orders, kill switch state, regime changes,
 * order lifecycle events, and kill switch triggers. Integrates with both
 * paper and live runners.
 *
 * Acceptance criteria (issue #78):
 *   AC3: Real-time status display: mode, regime, PnL, open orders, kill switch state
 *   AC4: Regime changes displayed with timestamps
 *   AC5: Order lifecycle events: submitted, accepted, filled, rejected with reasons
 *   AC6: Kill switch trigger clearly announced with reason and threshold
 */

// ── Types ────────────────────────────────────────────────────────────

export interface CycleStatusInput {
  /** Current mode (paper or live). */
  mode: string;
  /** Cycle number. */
  cycleCount: number;
  /** Current regime classification. */
  regime: string | undefined;
  /** Regime confidence (0–1). */
  regimeConfidence: number | undefined;
  /** Cumulative PnL (USD). */
  pnlUsd: number;
  /** Number of open/pending orders. */
  openOrders: number;
  /** Kill switch active state. */
  killSwitchActive: boolean;
  /** Orders submitted this cycle. */
  submitted: number;
  /** Orders blocked this cycle. */
  blocked: number;
  /** Total trades. */
  totalTrades: number;
}

export interface RegimeChangeInput {
  /** Previous regime. */
  fromRegime: string | undefined;
  /** New regime. */
  toRegime: string;
  /** Regime confidence. */
  confidence: number;
  /** Timestamp (Unix ms). */
  timestampMs: number;
}

export interface OrderEventInput {
  /** Order identifier. */
  orderId: string;
  /** Event type: submitted, accepted, filled, rejected, cancelled. */
  event: "submitted" | "accepted" | "filled" | "rejected" | "cancelled";
  /** Symbol traded. */
  symbol: string;
  /** Order side. */
  side: "BUY" | "SELL";
  /** Order quantity. */
  quantity: number;
  /** Fill price (for filled orders). */
  fillPrice?: number;
  /** Rejection/cancellation reason (if applicable). */
  reason?: string;
  /** Fees paid (for filled orders). */
  feesUsd?: number;
}

export interface KillSwitchTriggerInput {
  /** Trigger type: manual, daily-loss, weekly-loss, orphan-orders, etc. */
  trigger: string;
  /** Human-readable reason. */
  reason: string;
  /** Current threshold value. */
  threshold?: number;
  /** Threshold limit that was exceeded. */
  limit?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", " UTC");
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

// ── StatusDisplay ────────────────────────────────────────────────────

/**
 * StatusDisplay: prints structured status information to stdout
 * for each cycle, regime change, order event, and kill switch trigger.
 */
export class StatusDisplay {
  private readonly mode: string;
  private readonly logLevel: string;

  constructor(opts: { mode: string; logLevel?: string }) {
    this.mode = opts.mode;
    this.logLevel = opts.logLevel ?? "info";
  }

  /** Whether to display verbose (debug) output. */
  private get verbose(): boolean {
    return this.logLevel === "debug";
  }

  /**
   * AC3: Display cycle status after each cycle tick.
   * Shows mode, regime, PnL, open orders, kill switch state.
   */
  printCycleStatus(status: CycleStatusInput): void {
    const killIcon = status.killSwitchActive ? " ⛔ KILL" : " ✅";
    const regimeStr = status.regime ?? "unknown";
    const confStr =
      status.regimeConfidence !== undefined
        ? ` (${(status.regimeConfidence * 100).toFixed(0)}%)`
        : "";

    console.log(
      `[${status.mode}] Cycle ${status.cycleCount}: ` +
        `regime=${regimeStr}${confStr} ` +
        `PnL=$${status.pnlUsd.toFixed(2)} ` +
        `open=${status.openOrders} ` +
        `trades=${status.totalTrades}` +
        killIcon,
    );

    if (this.verbose) {
      console.log(
        `  submitted=${status.submitted} blocked=${status.blocked}`,
      );
    }
  }

  /**
   * AC4: Display regime change with timestamp.
   */
  printRegimeChange(change: RegimeChangeInput): void {
    const ts = formatTimestamp(change.timestampMs);
    const from = change.fromRegime ?? "none";
    const conf = (change.confidence * 100).toFixed(0);
    console.log(
      `[${this.mode}] 🔄 Regime change at ${ts}: ${from} → ${change.toRegime} (confidence: ${conf}%)`,
    );
  }

  /**
   * AC5: Display order lifecycle events.
   */
  printOrderEvent(event: OrderEventInput): void {
    const side = event.side === "BUY" ? "▲" : "▼";

    switch (event.event) {
      case "submitted":
        console.log(
          `[${this.mode}] 📤 Order submitted: ${side} ${event.symbol} ${event.side} ${event.quantity}`,
        );
        break;
      case "accepted":
        console.log(
          `[${this.mode}] ✅ Order accepted: ${side} ${event.symbol} ${event.side} ${event.quantity} (id: ${event.orderId})`,
        );
        break;
      case "filled":
        console.log(
          `[${this.mode}] 💰 FILL: ${side} ${event.symbol} ${event.side} ${event.quantity} @ $${(event.fillPrice ?? 0).toFixed(2)}` +
            (event.feesUsd !== undefined ? ` (fees: $${event.feesUsd.toFixed(4)})` : ""),
        );
        break;
      case "rejected":
        console.log(
          `[${this.mode}] ❌ Order REJECTED: ${side} ${event.symbol} ${event.side} ${event.quantity}` +
            (event.reason ? ` — reason: ${event.reason}` : ""),
        );
        break;
      case "cancelled":
        console.log(
          `[${this.mode}] 🚫 Order CANCELLED: ${side} ${event.symbol} ${event.side} ${event.quantity}` +
            (event.reason ? ` — reason: ${event.reason}` : ""),
        );
        break;
    }
  }

  /**
   * AC6: Announce kill switch trigger with reason and threshold.
   */
  printKillSwitchTrigger(trigger: KillSwitchTriggerInput): void {
    console.log();
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║              ⛔ KILL SWITCH ACTIVATED                    ║");
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(
      `║  Trigger:      ${padRight(trigger.trigger, 40)}║`,
    );
    console.log(
      `║  Reason:       ${padRight(trigger.reason.slice(0, 40), 40)}║`,
    );
    if (trigger.threshold !== undefined && trigger.limit !== undefined) {
      console.log(
        `║  Threshold:    ${padRight(`${trigger.threshold} / ${trigger.limit}`, 40)}║`,
      );
    }
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log();
  }
}
