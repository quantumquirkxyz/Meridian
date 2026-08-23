/**
 * PaperRunner: the first end-to-end runnable mode for AgentTrading.
 *
 * Connects to Bybit public WebSocket for real-time market data, feeds it
 * into GammaSession, simulates fills via PaperExecutionEngine, and produces
 * a full audit trail and session report. No API keys required.
 *
 * Acceptance criteria (issue #76):
 *   AC1: Connects to Bybit public WS (orderbook.50, trade) for configured symbols
 *   AC2: Normalizes WS events into MarketDataSnapshot and feeds to GammaSession
 *   AC3: Simulates fills via PaperExecutionEngine with configurable fill delay
 *   AC4: Simulates slippage based on order size and liquidity depth
 *   AC5: Runs cycle loop at configurable interval
 *   AC6: Classifies regime each cycle (RegimeClassifier integration)
 *   AC7: Produces audit trail: every decision logged to JSONL file
 *   AC8: Produces session summary: trades, PnL, regime changes, learning recs
 *   AC9: Demo end-to-end flow
 *   AC10: Works with zero API keys — only public WebSocket
 *   AC11: Graceful shutdown: close WS, flush logs, print summary
 */

import type { CanaryConfig, OrderIntent } from "@agenttrading/contracts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";
import { GammaSession, type GammaCycleInput } from "../gamma/gamma-session.ts";
import { PaperExecutionEngine, type PaperMarketSnapshot } from "../execution/paper-execution-engine.ts";
import { RegimeClassifier, type RegimeClassifierInput } from "../gamma/regime-classifier.ts";
import { PaperAuditLogger } from "./audit-logger.ts";
import { buildSessionReport, printSessionReport, type PaperTradeRecord } from "./session-report.ts";
import { computeSlippageBps } from "../utils/slippage.ts";
import type { MarketState } from "../utils/market-state.ts";

/** Minimal status display interface for injection into runners. */
export interface StatusDisplayLike {
  printCycleStatus(status: {
    mode: string;
    cycleCount: number;
    regime: string | undefined;
    regimeConfidence: number | undefined;
    pnlUsd: number;
    openOrders: number;
    killSwitchActive: boolean;
    submitted: number;
    blocked: number;
    totalTrades: number;
  }): void;
  printRegimeChange(change: {
    fromRegime: string | undefined;
    toRegime: string;
    confidence: number;
    timestampMs: number;
  }): void;
  printOrderEvent(event: {
    orderId: string;
    event: "submitted" | "accepted" | "filled" | "rejected" | "cancelled";
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    fillPrice?: number;
    reason?: string;
    feesUsd?: number;
  }): void;
  printKillSwitchTrigger(trigger: {
    trigger: string;
    reason: string;
    threshold?: number;
    limit?: number;
  }): void;
}

// ── Types ────────────────────────────────────────────────────────────

export interface PaperRunnerConfig {
  /** Symbols to subscribe to on Bybit public WS (e.g. ["BTCUSDT", "ETHUSDT"]). */
  symbols: string[];
  /** Cycle interval in milliseconds. */
  cycleIntervalMs: number;
  /** Fill delay in milliseconds (default: 500ms). */
  fillDelayMs?: number;
  /** Slippage in basis points (default: 10). */
  slippageBps?: number;
  /** Fee rate in basis points (default: 2). */
  feeBps?: number;
  /** Canary config override. */
  canaryConfig?: CanaryConfig;
  /** Path for the JSONL audit log file. */
  auditLogPath?: string;
  /** Session identifier for audit log correlation. Generated if omitted. */
  sessionId?: string;
  /** Injectable clock for testing. */
  nowMs?: () => number;
  /** Custom WebSocket factory (for testing). */
  wsFactory?: (url: string) => WebSocketLike;
  /** Optional status display for real-time cycle output. */
  statusDisplay?: StatusDisplayLike;
}

export interface PaperRunnerEvents {
  onCycle?: (cycleCount: number, result: { regime: string | undefined; submitted: number; blocked: number }) => void;
  onTrade?: (trade: PaperTradeRecord) => void;
  onError?: (error: Error) => void;
  onShutdown?: () => void;
}

/** Minimal WebSocket interface for the WS factory. */
interface WebSocketLike {
  readyState: number;
  close(): void;
  send(data: string | ArrayBuffer): void;
  addEventListener(type: string, handler: (event: unknown) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_FILL_DELAY_MS = 500;
const DEFAULT_SLIPPAGE_BPS = 10;
const DEFAULT_FEE_BPS = 2;
const DEFAULT_AUDIT_LOG_PATH = "./reports/paper-session.jsonl";
const DEFAULT_SYMBOLS = ["BTCUSDT"];
const BYBIT_PUBLIC_WS_URL = "wss://stream.bybit.com/v5/public/linear";
const WS_OPEN = 1;

// ── Helpers ──────────────────────────────────────────────────────────

// ── PaperRunner ──────────────────────────────────────────────────────

/**
 * PaperRunner: orchestrates the paper trading session.
 *
 * Flow:
 *   1. Connect to Bybit public WS (orderbook.50, trade)
 *   2. On market data: update internal market state
 *   3. On cycle tick: classify regime → detect opportunity → submit intent →
 *      simulate fill → record audit event
 *   4. On shutdown: close WS, flush audit log, print session report
 */
export class PaperRunner {
  private readonly config: Omit<Required<PaperRunnerConfig>, "sessionId" | "statusDisplay"> & { sessionId?: string; statusDisplay?: StatusDisplayLike };
  private readonly nowMs: () => number;
  private readonly wsFactory: (url: string) => WebSocketLike;

  // Core subsystems
  private readonly session: GammaSession;
  private readonly executionEngine: PaperExecutionEngine;
  private readonly regimeClassifier: RegimeClassifier;
  private readonly auditLogger: PaperAuditLogger;

  // State
  private running = false;
  private cycleCount = 0;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocketLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  // S2: Bundled market state (updated from WS)
  private market: MarketState = { bid: 0, ask: 0, mid: 0, liquidityUsd: 10_000 };
  private priceHistory: number[] = [];

  // Tracking
  private trades: PaperTradeRecord[] = [];
  private ordersSubmitted = 0;
  private ordersFilled = 0;
  private ordersBlocked = 0;
  private opportunitiesDetected = 0;
  private regimeChangeCount = 0;
  private lastRegime: string | undefined;
  private learningRecommendationCount = 0;
  private _startedAtMs = 0;
  private events: PaperRunnerEvents = {};

  constructor(config: PaperRunnerConfig) {
    this.nowMs = config.nowMs ?? (() => Date.now());
    this.wsFactory = config.wsFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);

    this.config = {
      symbols: config.symbols ?? DEFAULT_SYMBOLS,
      cycleIntervalMs: config.cycleIntervalMs,
      fillDelayMs: config.fillDelayMs ?? DEFAULT_FILL_DELAY_MS,
      slippageBps: config.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
      feeBps: config.feeBps ?? DEFAULT_FEE_BPS,
      canaryConfig: config.canaryConfig ?? DEFAULT_CANARY_CONFIG,
      auditLogPath: config.auditLogPath ?? DEFAULT_AUDIT_LOG_PATH,
      nowMs: this.nowMs,
      wsFactory: this.wsFactory,
      sessionId: config.sessionId,
      statusDisplay: config.statusDisplay,
    };

    // Initialize subsystems
    this.session = new GammaSession({
      canaryConfig: this.config.canaryConfig,
      learningCycleInterval: 10,
      now: this.nowMs,
    });
    this.executionEngine = new PaperExecutionEngine();
    this.regimeClassifier = new RegimeClassifier();
    this.auditLogger = new PaperAuditLogger({
      filePath: this.config.auditLogPath,
      nowMs: this.nowMs,
      sessionId: config.sessionId,
    });
  }

  /** Register event handlers. Must be called before start(). */
  on(events: PaperRunnerEvents): void {
    this.events = { ...this.events, ...events };
  }

  /** Session identifier from the audit logger. */
  get sessionId(): string {
    return this.auditLogger.sessionId;
  }

  /** Session start timestamp (Unix ms). 0 if not started. */
  get startedAtMs(): number {
    return this._startedAtMs;
  }

  /** Start the paper runner: connect WS, start cycle loop. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this._startedAtMs = this.nowMs();

    this.session.start();
    this.auditLogger.record("SESSION_STARTED", {
      symbols: this.config.symbols,
      cycleIntervalMs: this.config.cycleIntervalMs,
      fillDelayMs: this.config.fillDelayMs,
      slippageBps: this.config.slippageBps,
    });

    console.log(`[paper] Starting paper runner...`);
    console.log(`[paper] Symbols: ${this.config.symbols.join(", ")}`);
    console.log(`[paper] Cycle interval: ${this.config.cycleIntervalMs}ms`);
    console.log(`[paper] Fill delay: ${this.config.fillDelayMs}ms`);
    console.log(`[paper] Slippage: ${this.config.slippageBps}bps`);

    // Connect to Bybit public WS (AC1, AC10)
    await this.connectWebSocket();

    // Start cycle loop (AC5)
    this.cycleTimer = setInterval(() => {
      this.runCycle();
    }, this.config.cycleIntervalMs);

    console.log(`[paper] Paper runner started. Press Ctrl+C to stop.\n`);
  }

  /** Stop the paper runner: close WS, stop cycles, print report. */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    // Stop cycle loop
    if (this.cycleTimer !== null) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }

    // Close WebSocket (AC11)
    this.disconnectWebSocket();

    // Stop session
    this.session.stop();

    // Record session end
    const endedAtMs = this.nowMs();
    this.auditLogger.record("SESSION_ENDED", {
      durationMs: endedAtMs - this._startedAtMs,
      cycleCount: this.cycleCount,
      ordersSubmitted: this.ordersSubmitted,
      ordersFilled: this.ordersFilled,
      tradesCount: this.trades.length,
    });
    this.auditLogger.flush();

    // Build and print session report (AC8)
    const report = buildSessionReport({
      startedAtMs: this._startedAtMs,
      endedAtMs,
      cycleCount: this.cycleCount,
      opportunitiesDetected: this.opportunitiesDetected,
      ordersSubmitted: this.ordersSubmitted,
      ordersFilled: this.ordersFilled,
      ordersBlocked: this.ordersBlocked,
      trades: this.trades,
      regimeChangeCount: this.regimeChangeCount,
      finalRegime: this.lastRegime,
      learningRecommendationCount: this.learningRecommendationCount,
      auditEventCount: this.auditLogger.count,
    });
    printSessionReport(report);

    // S3: Wire onShutdown callback
    this.events.onShutdown?.();
    console.log("[paper] Session ended. Goodbye.");
  }

  // ── WebSocket ────────────────────────────────────────────────────

  private async connectWebSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = this.wsFactory(BYBIT_PUBLIC_WS_URL);

        const onOpen = () => {
          console.log("[paper] Connected to Bybit public WebSocket");

          // Subscribe to orderbook.50 and trade for each symbol (AC1)
          const args: string[] = [];
          for (const symbol of this.config.symbols) {
            args.push(`orderbook.50.${symbol}`);
            args.push(`trade.${symbol}`);
          }

          if (args.length > 0 && this.ws) {
            this.ws.send(JSON.stringify({ op: "subscribe", args }));
          }

          // Start ping keepalive
          this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WS_OPEN) {
              try {
                this.ws.send(JSON.stringify({ op: "ping" }));
              } catch {
                // ignore
              }
            }
          }, 20_000);

          resolve();
        };

        this.ws.addEventListener("open", onOpen);

        // If WebSocket is already open (e.g. mock in tests), fire immediately.
        if (this.ws.readyState === WS_OPEN) {
          onOpen();
        }

        this.ws.addEventListener("message", (event: unknown) => {
          const raw = typeof event === "object" && event !== null && "data" in event
            ? String((event as { data: unknown }).data)
            : String(event);
          this.handleWSMessage(raw);
        });

        // S3: Wire onError callback
        this.ws.addEventListener("error", (event: unknown) => {
          const msg = typeof event === "object" && event !== null && "message" in event
            ? String((event as { message: unknown }).message)
            : "ws error";
          console.error(`[paper] WebSocket error: ${msg}`);
          this.events.onError?.(new Error(msg));
        });

        this.ws.addEventListener("close", () => {
          console.log("[paper] WebSocket disconnected");
          if (this.pingTimer !== null) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
          }
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private disconnectWebSocket(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleWSMessage(raw: string): void {
    let parsed: { topic?: string; data: unknown; op?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (parsed.op === "pong") return;

    const topic = parsed.topic ?? "";

    // AC2: Normalize orderbook data into market state
    if (topic.startsWith("orderbook.") && typeof parsed.data === "object" && parsed.data !== null) {
      const data = parsed.data as { s?: string; b?: Array<{ price: string; size: string }>; a?: Array<{ price: string; size: string }> };
      if (data.b && data.a && data.b.length > 0 && data.a.length > 0) {
        const bid = parseFloat(data.b[0].price);
        const ask = parseFloat(data.a[0].price);
        this.market = {
          bid,
          ask,
          mid: (bid + ask) / 2,
          liquidityUsd: this.computeLiquidityDepth(data.b, data.a),
        };
      }
    }

    // AC2: Normalize trade data
    if (topic === "trade" && Array.isArray(parsed.data)) {
      for (const trade of parsed.data) {
        if (typeof trade === "object" && trade !== null && "p" in trade) {
          const t = trade as { p: string; s: string };
          const price = parseFloat(t.p);
          this.market = { ...this.market, bid: price, ask: price, mid: price };
        }
      }
    }
  }

  private computeLiquidityDepth(
    bids: Array<{ price: string; size: string }>,
    asks: Array<{ price: string; size: string }>,
  ): number {
    let totalDepth = 0;
    for (const level of bids) {
      totalDepth += parseFloat(level.size) * parseFloat(level.price);
    }
    for (const level of asks) {
      totalDepth += parseFloat(level.size) * parseFloat(level.price);
    }
    return totalDepth;
  }

  // ── S4: Extracted helpers ────────────────────────────────────────

  /** S4: Extract synthetic opportunity creation from runCycle. */
  private createSyntheticOpportunity(): { intent: OrderIntent; riskDecision: import("@agenttrading/contracts").ApprovedRiskDecision } | null {
    if (this.market.mid <= 0 || this.cycleCount % 5 !== 0) return null;

    const side: "BUY" | "SELL" = this.cycleCount % 10 === 0 ? "BUY" : "SELL";
    const quantity = 0.001;
    const price = this.market.mid;
    const orderSizeUsd = quantity * price;

    // SP1: Compute slippage dynamically from order size / liquidity
    const slippageBps = computeSlippageBps(orderSizeUsd, this.market.liquidityUsd, this.config.slippageBps);

    const intent: OrderIntent = {
      idempotencyKey: `paper-${this.cycleCount}`,
      opportunityId: `opp-${this.cycleCount}`,
      venue: "bybit",
      symbol: this.config.symbols[0] ?? "BTCUSDT",
      side,
      quantity,
      price,
      quoteCurrency: "USDT",
      createdAtMs: this.nowMs(),
      expiresAtMs: this.nowMs() + 60_000,
      limits: { maxSlippageBps: slippageBps },
    };

    const riskDecision: import("@agenttrading/contracts").ApprovedRiskDecision = {
      decision: "APPROVE",
      orderIntentIdempotencyKey: intent.idempotencyKey,
      evaluatedAtMs: this.nowMs(),
      approvedSize: quantity,
      approvedLimits: { maxSlippageBps: slippageBps },
      expiresAtMs: this.nowMs() + 60_000,
    };

    this.opportunitiesDetected++;
    this.auditLogger.record("OPPORTUNITY_DETECTED", {
      cycleCount: this.cycleCount,
      opportunityId: intent.opportunityId,
      symbol: intent.symbol,
      side,
      price,
      slippageBps,
    });

    return { intent, riskDecision };
  }

  /** S4: Extract fill simulation from runCycle. */
  private simulateFills(
    intents: OrderIntent[],
    riskDecisions: import("@agenttrading/contracts").RiskDecision[],
    submittedCount: number,
  ): void {
    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i];
      const riskDecision = riskDecisions[i];

      if (submittedCount > 0 || riskDecision.decision === "APPROVE") {
        const paperMarket: PaperMarketSnapshot = {
          bid: this.market.bid,
          ask: this.market.ask,
          mid: this.market.mid,
          liquidityUsd: this.market.liquidityUsd,
        };

        // SP1: Use the intent's slippage (already computed dynamically)
        const slippageBps = intent.limits.maxSlippageBps ?? this.config.slippageBps;

        this.executionEngine.submit({
          intent,
          riskDecision,
          market: paperMarket,
          submittedAtMs: this.nowMs(),
          fillDelayMs: this.config.fillDelayMs,
          slippageBps,
          feeBps: this.config.feeBps,
        });

        // Poll immediately to accept and fill
        const events = this.executionEngine.poll(this.nowMs() + this.config.fillDelayMs + 100);

        for (const event of events) {
          this.auditLogger.record("PAPER_ORDER_EVENT", {
            cycleCount: this.cycleCount,
            orderId: event.orderId,
            state: event.state,
            note: event.note,
          });

          if (event.state === "FILLED") {
            this.ordersFilled++;
            const snapshot = this.executionEngine.snapshot(event.orderId);
            if (snapshot) {
              const trade: PaperTradeRecord = {
                orderId: snapshot.orderId,
                symbol: intent.symbol,
                side: intent.side,
                fillPrice: snapshot.averageFillPrice ?? intent.price,
                fillQuantity: snapshot.filledQuantity,
                notionalUsd: snapshot.filledQuantity * (snapshot.averageFillPrice ?? intent.price),
                feesUsd: snapshot.totalFeesUsd,
                slippageBps,
                filledAtMs: snapshot.filledAtMs ?? this.nowMs(),
              };
              this.trades.push(trade);
              this.events.onTrade?.(trade);

              this.auditLogger.record("TRADE_FILLED", {
                cycleCount: this.cycleCount,
                orderId: trade.orderId,
                symbol: trade.symbol,
                side: trade.side,
                fillPrice: trade.fillPrice,
                fillQuantity: trade.fillQuantity,
                feesUsd: trade.feesUsd,
              });
            }
          }
        }
      }
    }
  }

  /** S4: Extract regime input derivation from runCycle. */
  private deriveRegimeInput(): RegimeClassifierInput {
    // SP2: Derive regime inputs from actual market data
    const spreadBps = this.market.bid > 0 && this.market.ask > 0
      ? ((this.market.ask - this.market.bid) / this.market.mid) * 10_000
      : 10;

    // SP2: Derive realized volatility from price history
    const realizedVolatility = this.computeRealizedVolatility();

    return {
      realizedVolatility,
      spreadBps,
      liquidityUsd: this.market.liquidityUsd,
      gasPriceUsd: 5,
      cumulativePnlUsd: 0,
      maxDrawdownUsd: 0,
      rpcHealthy: true,
      cexHealthy: true,
      directionalStreak: this.computeDirectionalStreak(),
      reversalCount: 0,
      nowMs: this.nowMs(),
    };
  }

  /** SP2: Compute realized volatility from recent price history. */
  private computeRealizedVolatility(): number {
    if (this.priceHistory.length < 2) return 0.5;

    const returns: number[] = [];
    for (let i = 1; i < this.priceHistory.length; i++) {
      const r = (this.priceHistory[i] - this.priceHistory[i - 1]) / this.priceHistory[i - 1];
      returns.push(r);
    }

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(365 * 24 * 60); // Annualize (rough)
  }

  /** SP2: Compute directional streak from price history. */
  private computeDirectionalStreak(): number {
    if (this.priceHistory.length < 2) return 0;

    let streak = 0;
    const last = this.priceHistory[this.priceHistory.length - 1];
    const prev = this.priceHistory[this.priceHistory.length - 2];
    const direction = last > prev ? 1 : -1;

    for (let i = this.priceHistory.length - 2; i > 0; i--) {
      const dir = this.priceHistory[i] > this.priceHistory[i - 1] ? 1 : -1;
      if (dir === direction) streak++;
      else break;
    }

    return streak;
  }

  // ── Cycle Loop (AC5, AC6) ─────────────────────────────────────────

  private runCycle(): void {
    if (!this.running) return;
    this.cycleCount++;

    // Track price history for volatility/streak computation
    if (this.market.mid > 0) {
      this.priceHistory.push(this.market.mid);
      if (this.priceHistory.length > 100) {
        this.priceHistory = this.priceHistory.slice(-100);
      }
    }

    // S4: Extracted regime input derivation
    const regimeInput = this.deriveRegimeInput();

    // AC6: Classify regime
    const regimeClassification = this.regimeClassifier.classify(regimeInput);
    if (regimeClassification.regime !== this.lastRegime) {
      this.regimeChangeCount++;
      this.lastRegime = regimeClassification.regime;
      this.auditLogger.record("REGIME_CHANGED", {
        cycleCount: this.cycleCount,
        regime: regimeClassification.regime,
        confidence: regimeClassification.confidence,
      });
    }

    // Build market snapshot for GammaSession
    const gammaMarket: GammaCycleInput["market"] = {
      bid: this.market.bid,
      ask: this.market.ask,
      mid: this.market.mid,
      liquidityUsd: this.market.liquidityUsd,
    };

    // S4: Extracted opportunity creation
    const intents: OrderIntent[] = [];
    const riskDecisions: import("@agenttrading/contracts").RiskDecision[] = [];

    const opportunity = this.createSyntheticOpportunity();
    if (opportunity) {
      intents.push(opportunity.intent);
      riskDecisions.push(opportunity.riskDecision);
    }

    // Run GammaSession cycle
    const result = this.session.runCycle({
      regime: regimeInput,
      market: gammaMarket,
      intents,
      riskDecisions,
    });

    this.ordersSubmitted += result.submittedCount;
    this.ordersBlocked += result.blockedCount;
    this.learningRecommendationCount += result.learningRecommendations.length;

    // S4: Extracted fill simulation
    this.simulateFills(intents, riskDecisions, result.submittedCount);

    // Log cycle completion (AC7)
    this.auditLogger.record("CYCLE_COMPLETE", {
      cycleCount: this.cycleCount,
      regime: regimeClassification.regime,
      regimeConfidence: regimeClassification.confidence,
      submitted: result.submittedCount,
      blocked: result.blockedCount,
      opportunitiesDetected: this.opportunitiesDetected,
      ordersFilled: this.ordersFilled,
    });

    this.events.onCycle?.(this.cycleCount, {
      regime: result.regimeClassification?.regime,
      submitted: result.submittedCount,
      blocked: result.blockedCount,
    });

    // AC3: Display cycle status via StatusDisplay if wired
    this.config.statusDisplay?.printCycleStatus({
      mode: "paper",
      cycleCount: this.cycleCount,
      regime: result.regimeClassification?.regime,
      regimeConfidence: result.regimeClassification?.confidence,
      pnlUsd: 0,
      openOrders: 0,
      killSwitchActive: false,
      submitted: result.submittedCount,
      blocked: result.blockedCount,
      totalTrades: this.trades.length,
    });

    console.log(
      `[paper] Cycle ${this.cycleCount}: regime=${result.regimeClassification?.regime ?? "unknown"} submitted=${result.submittedCount} blocked=${result.blockedCount} trades=${this.trades.length}`,
    );
  }
}
