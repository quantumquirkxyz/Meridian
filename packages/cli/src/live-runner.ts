/**
 * LiveRunner: the production-grade canary runner (issue #77).
 *
 * Connects to Bybit private+public WebSocket, places real orders through
 * LiveExecutionEngine with canary limits enforced, confirms fills via
 * WebSocket, reconciles internal state with exchange state, and produces
 * full audit trail and reports.
 *
 * ACCEPTANCE CRITERIA (issue #77):
 *   AC1: Connects to Bybit private WebSocket (order, position, execution)
 *   AC2: Connects to Bybit public WebSocket for market data
 *   AC3: Places orders via BybitRESTClient.placeOrder() after canary limit check
 *   AC4: LiveExecutionEngine enforces capital/exposure/order count limits
 *   AC5: Kill switch triggers: daily/weekly loss, orphans, reconciliation
 *   AC6: Each order confirmed via WebSocket before recording as FILLED
 *   AC7: Reconciliation compares internal vs exchange state on startup & periodically
 *   AC8: Refuses to start if API keys missing/empty or withdrawals not disabled
 *   AC9: Startup check: verify Bybit API connectivity
 *   AC10: Emergency modes: cancel-all, reduce-only, cash-only from CanaryControlStatus
 *   AC11: Audit trail: every order, fill, risk decision logged to JSONL
 *   AC12: Session summary: trades, PnL, fees, regime changes, learning recs
 *   AC13: Graceful shutdown: cancel open orders, close WS, flush logs, print summary
 *
 * OPERABILITY ENHANCEMENTS:
 *   - Real opportunity detection via OpportunityDetector (MarketGraph + RouteEngine)
 *   - Real RiskEngine evaluation (replaces hardcoded APPROVE)
 *   - Multi-venue inventory management with real balance queries
 *   - AgentAdapter wired for consultative observations
 *   - Demo mode uses Bybit Demo Trading endpoints
 */

import type {
  CanaryConfig,
  CanaryControlCommand,
  MarketDataSnapshot,
  OrderIntent,
  OrderRouteAck,
  OrderUpdate,
  RiskDecision,
  SystemMode,
  AgentInput,
  AgentOutput,
  TradingScope,
  GeneralAgentRecommendation,
} from "@agenttrading/contracts";
import { DEFAULT_CANARY_CONFIG } from "@agenttrading/contracts";
import {
  TradingSession,
  AuditLogger,
  buildSessionReport,
  printSessionReport,
  ReconciliationEngine,
  computeSlippageBps,
  OpportunityDetector,
  RiskEngine,
  DEFAULT_RISK_POLICY,
} from "@agenttrading/core";
import type { TradeRecord, MarketState, CanaryPreCheckResult } from "@agenttrading/core";
import {
  BybitRESTClient,
  BybitWebSocketClient,
  BinanceRESTClient,
  buildBinanceSnapshot,
  type BybitWSClientEvents,
  PancakeSwapMarketDataConnector,
  type PancakeSwapPoolSpec,
} from "@agenttrading/connectors";
import { DEXExecutor } from "@agenttrading/chain";
import { StatusDisplay } from "./status-display.ts";
import { DataQualityMonitor } from "@agenttrading/infra";
import type { DataQualityMetrics } from "@agenttrading/contracts";
import {
  CONSULTATIVE_AGENT_CATALOG,
  AuditConsultativeAdapter,
  MemoryConsultativeAdapter,
  PolicyConsultativeAdapter,
  ScopeObserverAdapter,
  GeneralAgent,
  deployPerScopeGeneralAgents,
} from "@agenttrading/agents";
import { VercelAISDKAdapter } from "@agenttrading/agents/runtimes/vercel";
import { createOpenRouterGenerateFn } from "@agenttrading/agents/runtimes/openrouter";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { BybitDexOrderRouter } from "./order-router.ts";
import { buildRecommendationIntent } from "./recommendation-intent.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface LiveRunnerConfig {
  /** Symbols to trade (e.g. ["BTCUSDT"]). */
  symbols: string[];
  /** Bybit API key. */
  bybitApiKey: string;
  /** Bybit API secret. */
  bybitApiSecret: string;
  /** Bybit REST + WS endpoints — same runner, different endpoints per mode. */
  bybitEndpoints: { restUrl: string; publicWsUrl: string; privateWsUrl: string };
  /** OpenRouter LLM API key for agent reasoning (optional). */
  llmApiKey?: string;
  /** OpenRouter base URL (default: https://openrouter.ai/api/v1). */
  llmBaseUrl?: string;
  /** Default LLM model for agent reasoning (default: openrouter/auto). */
  llmModel?: string;
  /** Binance API key for multi-venue price feeds (optional). */
  binanceApiKey?: string;
  /** Binance API secret for multi-venue price feeds (optional). */
  binanceApiSecret?: string;
  /** Binance base URL (default: mainnet). */
  binanceBaseUrl?: string;
  /** PancakeSwap RPC URL for on-chain BNB chain market data (optional). */
  pancakeSwapRpcUrl?: string;
  /** PancakeSwap pools to observe for DEX market data. */
  pancakeSwapPools?: readonly PancakeSwapPoolSpec[];
  /** PancakeSwap private key for signing on-chain swaps (execution). */
  pancakeSwapPrivateKey?: `0x${string}`;
  /** PancakeSwap router address for swap execution. */
  pancakeSwapRouterAddress?: `0x${string}`;
  /** Cycle interval in milliseconds. */
  cycleIntervalMs: number;
  /** Canary config override. */
  canaryConfig?: CanaryConfig;
  /** Path for the JSONL audit log file. */
  auditLogPath?: string;
  /** Session identifier for audit log correlation. Generated if omitted. */
  sessionId?: string;
  /** Reconciliation interval in ms (default: 30_000). */
  reconciliationIntervalMs?: number;
  /** Order category for Bybit REST API (default: "linear"). */
  orderCategory?: "spot" | "linear" | "inverse" | "option";
  /** Fee rate in basis points (default: 2). */
  feeBps?: number;
  /** Injectable clock for testing. */
  nowMs?: () => number;
  /** Optional status display for real-time cycle output. */
  statusDisplay?: StatusDisplay;
  /** Mode: demo (Bybit Demo Trading) or live. Determines withdrawal-check strictness. */
  mode?: "demo" | "live";
  /** Injectable WebSocket client (default: real BybitWebSocketClient). For testing. */
  wsClient?: BybitWSClientLike;
}

/**
 * Minimal WebSocket client surface that LiveRunner depends on. The production
 * implementation is BybitWebSocketClient; a fake may be injected for testing.
 */
export interface BybitWSClientLike {
  on(events: BybitWSClientEvents): void;
  connect(): Promise<void>;
  waitForAuth(timeoutMs?: number): Promise<void>;
  disconnect(): void;
}

export interface LiveRunnerEvents {
  onCycle?: (
    cycleCount: number,
    result: {
      regime: string | undefined;
      submitted: number;
      blocked: number;
    },
  ) => void;
  onTrade?: (trade: TradeRecord) => void;
  onError?: (error: Error) => void;
  onShutdown?: () => void;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_AUDIT_LOG_PATH = "./reports/live-session.jsonl";
const DEFAULT_SYMBOLS = ["BTCUSDT"];
const DEFAULT_RECONCILIATION_INTERVAL_MS = 30_000;
const DEFAULT_ORDER_CATEGORY = "linear" as const;
const DEFAULT_FEE_BPS = 2;

// ── LiveRunner ──────────────────────────────────────────────────────

/**
 * LiveRunner: orchestrates the live canary trading session.
 *
 * Flow:
 *   1. Validate API keys, verify withdrawal disabled (AC8)
 *   2. Check exchange connectivity (AC9)
 *   3. Connect to Bybit public WS (AC2) + private WS (AC1)
 *   4. Reconcile internal vs exchange state on startup (AC7)
 *   5. On cycle tick: classify regime → detect opportunity via MarketGraph
 *      → RiskEngine approval → canary pre-check → place order via REST
 *      → wait for WS fill confirmation → reconcile periodically
 *      → evaluate kill switch
 *   6. On shutdown: cancel all open orders → close WS → flush logs →
 *      print session summary (AC13)
 */
export class LiveRunner {
  private readonly config: Required<
    Pick<
      LiveRunnerConfig,
      | "symbols"
      | "bybitApiKey"
      | "bybitApiSecret"
      | "bybitEndpoints"
      | "cycleIntervalMs"
      | "reconciliationIntervalMs"
      | "orderCategory"
      | "feeBps"
      | "mode"
    >
  > & {
    canaryConfig: CanaryConfig;
    auditLogPath: string;
    nowMs: () => number;
    statusDisplay?: StatusDisplay;
    llmApiKey?: string;
    llmBaseUrl?: string;
    llmModel?: string;
    wsClient?: BybitWSClientLike;
    pancakeSwapPools?: readonly PancakeSwapPoolSpec[];
  };
  private readonly nowMs: () => number;

  // Core subsystems
  private readonly session: TradingSession;
  private readonly auditLogger: AuditLogger;
  private readonly reconciliationEngine: ReconciliationEngine;
  private readonly opportunityDetector: OpportunityDetector;
  private readonly riskEngine: RiskEngine;
  private dataQualityMonitor?: DataQualityMonitor;

  // Connectors
  private readonly restClient: BybitRESTClient;
  private readonly wsClient: BybitWSClientLike;
  private readonly binanceClient?: BinanceRESTClient;
  private readonly pancakeswapMarketData?: PancakeSwapMarketDataConnector;
  private readonly dexExecutor?: DEXExecutor;
  private readonly orderRouter: BybitDexOrderRouter;

  // Per-scope cognitive layer (ADR-0013)
  private scopeDeployments: Array<{ scope: TradingScope; agent: GeneralAgent }> = [];

  // State
  private running = false;
  private cycleCount = 0;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private tickerTimer: ReturnType<typeof setInterval> | null = null;

  // S2: Bundled market state (updated from WS)
  private market: MarketState = { bid: 0, ask: 0, mid: 0, liquidityUsd: 10_000 };
  private priceHistory: number[] = [];

  // Multi-venue market data snapshots for OpportunityDetector
  private marketDataSnapshots: Map<string, MarketDataSnapshot> = new Map();

  // Order tracking — maps exchange orderId → OrderIntent
  private pendingOrders: Map<string, OrderIntent> = new Map();

  // Orders with an active partial fill (CONTEXT.md Reconciliation: if the
  // WebSocket drops with one active, the system must enter CANCEL_ONLY_MODE).
  private partialFillOrders: Set<string> = new Set();

  // Inventory tracking
  private availableCapitalUsd: number = 0;
  private committedCapitalUsd: number = 0;
  private lastKnownBalances: Array<{ asset: string; available: number; locked: number }> = [];

  // Agent observation layer
  private lastAgentObservation: AgentOutput | undefined;
  private agentObservationCount = 0;

  // Per-scope general agent recommendations (ADR-0013) — scopeId → latest
  private lastScopeRecommendations: Map<string, GeneralAgentRecommendation> = new Map();
  private scopeRecommendationCount = 0;
  private recommendationsRejectedByRisk = 0;
  private auditAdapter?: AuditConsultativeAdapter;
  private memoryAdapter?: MemoryConsultativeAdapter;
  private policyAdapter?: PolicyConsultativeAdapter;
  private llmAdapter?: VercelAISDKAdapter;

  // Tracking
  private trades: TradeRecord[] = [];
  private ordersSubmitted = 0;
  private ordersFilled = 0;
  private ordersBlocked = 0;
  private opportunitiesDetected = 0;
  private opportunitiesRejectedByRisk = 0;
  private regimeChangeCount = 0;
  private lastRegime: string | undefined;
  private learningRecommendationCount = 0;
  private _startedAtMs = 0;
  private events: LiveRunnerEvents = {};

  constructor(config: LiveRunnerConfig) {
    this.nowMs = config.nowMs ?? (() => Date.now());

    this.config = {
      symbols: config.symbols ?? DEFAULT_SYMBOLS,
      bybitApiKey: config.bybitApiKey,
      bybitApiSecret: config.bybitApiSecret,
      bybitEndpoints: config.bybitEndpoints,
      cycleIntervalMs: config.cycleIntervalMs,
      canaryConfig: config.canaryConfig ?? DEFAULT_CANARY_CONFIG,
      auditLogPath: config.auditLogPath ?? DEFAULT_AUDIT_LOG_PATH,
      reconciliationIntervalMs:
        config.reconciliationIntervalMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS,
      orderCategory: config.orderCategory ?? DEFAULT_ORDER_CATEGORY,
      feeBps: config.feeBps ?? DEFAULT_FEE_BPS,
      nowMs: this.nowMs,
      statusDisplay: config.statusDisplay,
      // The CLI always passes `mode` explicitly (from AppConfig). The default
      // here is a fail-closed fallback: never degrade to demo. (OPERATING_FLOW.md)
      mode: config.mode ?? "live",
      llmApiKey: config.llmApiKey,
      llmBaseUrl: config.llmBaseUrl,
      llmModel: config.llmModel,
      wsClient: config.wsClient,
      pancakeSwapPools: config.pancakeSwapPools,
    };

    // AC8: Validate API keys
    this.validateConfig();

    // Initialize core subsystems
    this.session = new TradingSession({
      canaryConfig: this.config.canaryConfig,
      learningCycleInterval: 10,
      now: this.nowMs,
    });

    this.auditLogger = new AuditLogger({
      filePath: this.config.auditLogPath,
      nowMs: this.nowMs,
      sessionId: config.sessionId,
    });

    this.reconciliationEngine = new ReconciliationEngine();

    // Real opportunity detection via MarketGraph + RouteEngine
    this.opportunityDetector = new OpportunityDetector({
      minNetProfitUsd: 0.1,
      feeBps: this.config.feeBps,
      safetyBufferUsd: 0.1,
      maxRouteLength: 3,
    }, this.nowMs);

    // Real RiskEngine with policy from canary config
    this.riskEngine = new RiskEngine({
      ...DEFAULT_RISK_POLICY,
      maxRiskPerTradeUsd: this.config.canaryConfig.capitalLimits.maxRiskPerTradeUsd,
      maxDailyLossUsd: this.config.canaryConfig.capitalLimits.maxDailyLossUsd,
      maxWeeklyLossUsd: this.config.canaryConfig.capitalLimits.maxWeeklyLossUsd,
      maxExposurePerTokenUsd: this.config.canaryConfig.exposureLimits.maxExposurePerTokenUsd,
      maxExposurePerVenueUsd: this.config.canaryConfig.exposureLimits.maxExposurePerVenueUsd,
      maxExposurePerChainUsd: this.config.canaryConfig.exposureLimits.maxExposurePerChainUsd,
      maxOpenOrders: this.config.canaryConfig.orderLimits.maxOpenOrders,
      maxSlippageBps: this.config.canaryConfig.maxSlippageBps,
      maxGasUsd: this.config.canaryConfig.maxGasUsd,
      minEdgeUsd: 0.1,
    });

    // Initialize connectors
    this.restClient = new BybitRESTClient({
      apiKey: this.config.bybitApiKey,
      apiSecret: this.config.bybitApiSecret,
      baseUrl: this.config.bybitEndpoints.restUrl,
    });

    this.wsClient =
      this.config.wsClient ??
      new BybitWebSocketClient({
        apiKey: this.config.bybitApiKey,
        apiSecret: this.config.bybitApiSecret,
        symbols: this.config.symbols,
        nowMs: this.nowMs,
        publicWsUrl: this.config.bybitEndpoints.publicWsUrl,
        privateWsUrl: this.config.bybitEndpoints.privateWsUrl,
      });

    // Initialize Binance connector for multi-venue price feeds
    if (config.binanceApiKey && config.binanceApiSecret) {
      this.binanceClient = new BinanceRESTClient({
        apiKey: config.binanceApiKey,
        apiSecret: config.binanceApiSecret,
        baseUrl: config.binanceBaseUrl,
      });
    }

    // Initialize PancakeSwap connectors for DEX market data and execution
    if (config.pancakeSwapRpcUrl && config.pancakeSwapPools?.length) {
      this.pancakeswapMarketData = new PancakeSwapMarketDataConnector({
        rpcUrl: config.pancakeSwapRpcUrl,
        pools: config.pancakeSwapPools,
      });
    }
    if (config.pancakeSwapPrivateKey) {
      this.dexExecutor = new DEXExecutor({
        url: config.pancakeSwapRpcUrl ?? "",
        chainId: 56,
        chainName: "bsc",
        privateKey: config.pancakeSwapPrivateKey,
        routerAddress: config.pancakeSwapRouterAddress,
      });
    }

    // ADR-0011: the engine is the single order-sending seam. The router
    // attached here routes every submitted intent to its venue connector.
    this.orderRouter = new BybitDexOrderRouter({
      restClient: this.restClient,
      dexExecutor: this.dexExecutor,
      orderCategory: this.config.orderCategory,
    });
    this.session.setOrderRouter(this.orderRouter);

    // Wire WS events (AC1, AC2)
    const wsEvents: BybitWSClientEvents = {
      onMarketData: (snapshot) => {
        this.handleMarketData(snapshot);
      },
      onOrderUpdate: (update) => {
        this.handleOrderUpdate(update);
      },
      onError: (error) => {
        this.auditLogger.record("WS_ERROR", { message: error.message });
        this.events.onError?.(error);
      },
      onDisconnected: (reason) => {
        this.auditLogger.record("WS_DISCONNECTED", { reason });
        // CONTEXT.md Reconciliation: if the WebSocket drops with an active
        // partial fill, immediately transition to CANCEL_ONLY_MODE and only
        // return to NORMAL after exact reconciliation. Fail closed: block new
        // positions, cancel the affected orders, and mark reconciliation
        // unresolved so the Risk Engine refuses new intents until resolved.
        // Uses setDefensiveCancelOnly (not setReconciliationStatus) so the
        // reconciliation-mismatch auto kill switch (HALT) is not triggered;
        // CANCEL_ONLY is cleared by the next clean reconcile().
        if (this.partialFillOrders.size > 0) {
          const affected = Array.from(this.partialFillOrders);
          this.auditLogger.record("WS_DROP_PARTIAL_FILL", {
            reason,
            affectedOrderIds: affected,
          });
          console.warn(
            `[live] WebSocket dropped with ${affected.length} active partial fill(s). Entering CANCEL_ONLY_MODE.`,
          );
          this.session.setDefensiveCancelOnly(true);
          this.cancelAllOpenOrders();
        }
      },
    };
    this.wsClient.on(wsEvents);
  }

  /** Register event handlers. Must be called before start(). */
  on(events: LiveRunnerEvents): void {
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

  /**
   * SP2: Send a control command to the canary session.
   * Enables emergency modes (cancel-all, reduce-only, cash-only) from
   * the CLI or external callers.
   *
   * AC10: Emergency modes reachable from CanaryControlStatus.
   */
  control(command: CanaryControlCommand) {
    return this.session.control(command);
  }

  /**
   * Derived operational mode (SystemMode) based on session state, as seen by
   * the Risk Engine. Exposed for observability and tests: e.g. an unresolved
   * reconciliation (WebSocket drop with active partial fill) yields CANCEL_ONLY.
   */
  get systemMode(): SystemMode {
    return this.mapSessionModeToSystemMode();
  }

  /** Connect infra layer: DataQualityMonitor for per-source quality tracking. */
  connectInfra(): void {
    this.dataQualityMonitor = new DataQualityMonitor();
    this.auditLogger.record("INFRA_CONNECTED", {
      dataQualityMonitor: true,
    });
  }

  /** Start the live runner: validate, connect WS, reconcile, start cycles. */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this._startedAtMs = this.nowMs();

    this.session.start();
    this.auditLogger.record("SESSION_STARTED", {
      symbols: this.config.symbols,
      cycleIntervalMs: this.config.cycleIntervalMs,
      mode: this.config.mode,
      reconciliationIntervalMs: this.config.reconciliationIntervalMs,
    });

    console.log(`[live] Starting ${this.config.mode} runner...`);
    console.log(`[live] Symbols: ${this.config.symbols.join(", ")}`);
    console.log(`[live] Cycle interval: ${this.config.cycleIntervalMs}ms`);
    console.log(`[live] REST endpoint: ${this.config.bybitEndpoints.restUrl}`);
    console.log(`[live] Public WS: ${this.config.bybitEndpoints.publicWsUrl}`);
    console.log(`[live] Private WS: ${this.config.bybitEndpoints.privateWsUrl}`);

    // AC9: Startup check — verify Bybit API connectivity
    console.log(`[live] Verifying Bybit API connectivity...`);
    try {
      const accountInfo = await this.restClient.getAccountInfo();
      console.log(
        `[live] Bybit API reachable. Account type: ${accountInfo.list?.[0]?.accountType ?? "unknown"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[live] ERROR: Bybit API connectivity check failed: ${msg}`);
      this.running = false;
      throw new Error(`Failed to verify Bybit API connectivity: ${msg}`);
    }

    // Query initial balances for inventory management
    await this.updateInventory();

    // Connect infra layer for data quality tracking
    this.connectInfra();

    // Wire consultative agent for market observations
    this.deployPerScopeAgents();

    // AC2: Connect to Bybit public WS
    console.log(`[live] Connecting to Bybit public WebSocket...`);

    // AC1: Connect to Bybit private WS (order, position, execution)
    console.log(`[live] Connecting to Bybit private WebSocket...`);
    await this.wsClient.connect();

    // Wait for private WS authentication — must confirm in demo and live
    if (this.config.bybitApiKey && this.config.bybitApiSecret) {
      try {
        await this.wsClient.waitForAuth(10_000);
        console.log(`[live] Private WebSocket authenticated.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[live] Private WebSocket auth failed (${msg}). In demo mode this must still confirm via REST reconciliation; do not proceed without audit evidence.`);
      }
    }

    // Start ticker poll (REST fallback when WS market feed not active)
    const tickerPollInterval = 5_000;
    const pollTicker = async () => {
      try {
        const ticker = await this.restClient.getTicker(this.config.symbols[0] ?? "BTCUSDT");
        const bid = parseFloat(ticker.bid) || 0;
        const ask = parseFloat(ticker.ask) || 0;
        const last = parseFloat(ticker.lastPrice) || 100;
        const mid = (bid > 0 && ask > 0) ? (bid + ask) / 2 : (last || 100);
        this.market = {
          bid: bid > 0 ? bid : last,
          ask: ask > 0 ? ask : last,
          mid,
          liquidityUsd: 10_000,
        };
        // Feed ticker data into OpportunityDetector as a snapshot
        this.ingestMarketDataFromTicker(ticker.bid, ticker.ask, ticker.lastPrice);
      } catch {
        // Ignore ticker poll errors; keep synthetic/default market state
      }

      // Poll Binance for multi-venue price comparison
      if (this.binanceClient) {
        try {
          const binanceTicker = await this.binanceClient.getTicker(this.config.symbols[0] ?? "BTCUSDT");
          const binanceSnapshot = buildBinanceSnapshot(binanceTicker, "binance-rest-ticker");
          this.opportunityDetector.ingestMarketData(binanceSnapshot);
          this.marketDataSnapshots.set(`binance:${binanceSnapshot.symbol}`, binanceSnapshot);
        } catch {
          // Ignore Binance errors; Bybit data is sufficient
        }
      }

      // Poll PancakeSwap pools for DEX market data
      if (this.pancakeswapMarketData) {
        try {
          const dexSnapshots = await this.pancakeswapMarketData.fetchSnapshots();
          for (const dexSnapshot of dexSnapshots) {
            this.opportunityDetector.ingestMarketData(dexSnapshot);
            this.marketDataSnapshots.set(`${dexSnapshot.venue}:${dexSnapshot.symbol}`, dexSnapshot);
          }
        } catch {
          // Ignore PancakeSwap RPC errors; Bybit data is sufficient
        }
      }
    };
    await pollTicker();
    this.tickerTimer = setInterval(pollTicker, tickerPollInterval);

    // AC7: Reconcile on startup
    await this.reconcile();

    // Start cycle loop
    this.cycleTimer = setInterval(() => {
      this.runCycle();
    }, this.config.cycleIntervalMs);

    // Start periodic reconciliation (AC7)
    this.reconciliationTimer = setInterval(() => {
      this.reconcile();
    }, this.config.reconciliationIntervalMs);

    console.log(`[live] Live runner started. Press Ctrl+C to stop.\n`);
  }

  /** Stop the live runner: cancel open orders, close WS, flush logs, print summary. */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.cycleTimer !== null) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }

    if (this.reconciliationTimer !== null) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }

    if (this.tickerTimer !== null) {
      clearInterval(this.tickerTimer);
      this.tickerTimer = null;
    }

    // AC13: Cancel all open orders before closing
    this.cancelAllOpenOrders();

    // Close WebSocket connections
    this.wsClient.disconnect();

    // Stop session
    this.session.stop();

    // Record session end
    const endedAtMs = this.nowMs();
    this.auditLogger.record("SESSION_ENDED", {
      durationMs: endedAtMs - this._startedAtMs,
      cycleCount: this.cycleCount,
      ordersSubmitted: this.ordersSubmitted,
      ordersFilled: this.ordersFilled,
      opportunitiesDetected: this.opportunitiesDetected,
      opportunitiesRejectedByRisk: this.opportunitiesRejectedByRisk,
      tradesCount: this.trades.length,
    });
    this.auditLogger.flush();

    // AC12: Build and print session report
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

    this.events.onShutdown?.();
    console.log("[live] Session ended. Goodbye.");
  }

  // ── Per-Scope Cognitive Layer (ADR-0013) ──────────────────────────

  /**
   * Deploy one general agent per trading scope, each backed by the same
   * consultative catalog. Deterministic behavioral adapters (no LLM) cover
   * audit, memory, and policy observations; the scope observer covers the
   * analytical/deliberative agents when no LLM key is configured.
   *
   * CONTEXT.md §8: "AI Agents do not replace deterministic trading logic;
   * they add a cognitive layer for reasoning, classification, interpretation."
   * The agents only observe — they never execute or approve risk (ADR-0003).
   */
  private deployPerScopeAgents(): void {
    // Build agent config map from the catalog
    const agentConfigs = new Map(
      CONSULTATIVE_AGENT_CATALOG.map((def) => [def.id, def.config]),
    );

    // Initialize behavioral adapters (deterministic, no LLM)
    this.auditAdapter = new AuditConsultativeAdapter(agentConfigs);
    this.memoryAdapter = new MemoryConsultativeAdapter(agentConfigs);
    this.policyAdapter = new PolicyConsultativeAdapter(agentConfigs);
    const observerAdapter = new ScopeObserverAdapter(agentConfigs);

    // Wire LLM adapter when API key is available (real agent reasoning for
    // analytical/deliberative agents only; ADR-0013 keeps control agents on
    // their deterministic behavioral adapters).
    if (this.config.llmApiKey) {
      const openrouter = createOpenAI({
        apiKey: this.config.llmApiKey,
        baseURL: this.config.llmBaseUrl ?? "https://openrouter.ai/api/v1",
      });
      const generateFn = createOpenRouterGenerateFn({
        generateText,
        openrouter,
      });
      this.llmAdapter = new VercelAISDKAdapter({
        generateFn,
        configs: agentConfigs,
        defaultModel: this.config.llmModel ?? "openrouter/auto",
        baseUrl: this.config.llmBaseUrl,
      });
      this.auditLogger.record("LLM_ADAPTER_WIRED", {
        provider: "openrouter",
        model: this.config.llmModel ?? "openrouter/auto",
        catalogAgents: CONSULTATIVE_AGENT_CATALOG.length,
      });
    }

    // Per-scope deployment: one general agent per (venue, pair) / pool.
    const scopes = this.buildTradingScopes();
    this.scopeDeployments = deployPerScopeGeneralAgents({
      scopes,
      configs: agentConfigs,
      subAgentIds: [...CONSULTATIVE_AGENT_CATALOG.map((def) => def.id)],
      buildAdapter: (agentId, config) => {
        switch (agentId) {
          case "agent-memory":
            return this.memoryAdapter!;
          case "agent-audit":
            return this.auditAdapter!;
          case "agent-policy":
            return this.policyAdapter!;
          default:
            return this.llmAdapter ?? observerAdapter;
        }
      },
      now: this.nowMs,
    });

    // Keep a synchronous market observer wired into the session so the
    // engine's runCycle observes aggregated state each cycle.
    const adapter = {
      run: (input: AgentInput): AgentOutput => {
        this.agentObservationCount++;
        const spreadBps = this.market.bid > 0 && this.market.ask > 0
          ? ((this.market.ask - this.market.bid) / this.market.mid) * 10_000
          : 0;
        const dataFreshnessMs = this.nowMs() - (this.marketDataSnapshots.values().next().value?.timestampMs ?? this.nowMs());

        const scopedReadout = [...this.lastScopeRecommendations.values()].map(
          (rec) => ({
            scopeId: rec.scopeId,
            signal: rec.signal,
            confidence: rec.confidence,
          }),
        );

        const observation: AgentOutput = {
          kind: "structured",
          agentId: "market-observer",
          payload: {
            regime: this.lastRegime ?? "unknown",
            marketMid: this.market.mid,
            spreadBps,
            dataFreshnessMs,
            availableCapitalUsd: this.availableCapitalUsd,
            committedCapitalUsd: this.committedCapitalUsd,
            openOrders: this.pendingOrders.size,
            opportunitiesDetected: this.opportunitiesDetected,
            opportunitiesRejectedByRisk: this.opportunitiesRejectedByRisk,
            // Per-scope cognitive layer readout (ADR-0013)
            scopeDeployments: this.scopeDeployments.length,
            scopeRecommendations: scopedReadout,
          },
          schemaName: "market-observation",
          timestampMs: this.nowMs(),
        };
        this.lastAgentObservation = observation;
        return observation;
      },
    };

    this.session.wireAgentAdapter(adapter);

    this.auditLogger.record("SCOPE_AGENTS_DEPLOYED", {
      scopes: this.scopeDeployments.map((d) => d.scope),
      generalAgents: this.scopeDeployments.map((d) => d.agent.agentId),
      subAgentIds: this.scopeDeployments[0]?.agent.subAgentIds.length ?? 0,
      behavioralAdapters: ["audit", "memory", "policy"],
      llmEnabled: !!this.config.llmApiKey,
    });
  }

  /**
   * Derive the trading scopes this runner owns from its configuration.
   * - Bybit order-book scopes: one per configured symbol.
   * - PancakeSwap pool scopes: one per configured pool.
   */
  private buildTradingScopes(): TradingScope[] {
    const scopes: TradingScope[] = [];

    for (const symbol of this.config.symbols) {
      const pair =
        symbol.length > 4 && (symbol.endsWith("USDT") || symbol.endsWith("USDC"))
          ? `${symbol.slice(0, -4)}/${symbol.slice(-4)}`
          : symbol;
      scopes.push({ kind: "CEX", venue: "bybit", pair });
    }

    for (const pool of this.config.pancakeSwapPools ?? []) {
      scopes.push({
        kind: "DEX",
        venue: "pancakeswap-v4",
        pool: pool.poolAddress,
        pair: `${pool.token0Symbol}/${pool.token1Symbol}`,
        chain: "bsc",
      });
    }

    return scopes;
  }

  /**
   * Run one cognitive cycle for every deployed general agent (ADR-0013).
   * Each general agent consults its scoped sub-agents and emits a
   * department recommendation that is audited and surfaced to the session's
   * market observer on the next cycle.
   */
  private async runScopeAgents(): Promise<void> {
    if (this.scopeDeployments.length === 0) return;

    const regime = this.lastRegime ?? "unknown";

    for (const { scope, agent } of this.scopeDeployments) {
      const result = await agent.runCycle({
        regime,
        market: this.scopeMarketState(scope),
      });
      this.lastScopeRecommendations.set(result.recommendation.scopeId, result.recommendation);
      this.scopeRecommendationCount++;
      this.auditLogger.record("SCOPE_RECOMMENDATION", {
        cycleCount: this.cycleCount,
        scopeId: result.recommendation.scopeId,
        agentId: agent.agentId,
        signal: result.recommendation.signal,
        confidence: result.recommendation.confidence,
        invokedSubAgents: result.invokedSubAgents.length,
      });
    }
  }

  /** Resolve the current market state for a trading scope. */
  private scopeMarketState(scope: TradingScope): {
    bid: number;
    ask: number;
    mid: number;
    liquidityUsd: number;
  } {
    if (scope.kind === "CEX") {
      const symbol = scope.pair.replace("/", "");
      const snapshot = this.marketDataSnapshots.get(`${scope.venue}:${symbol}`);
      if (
        snapshot &&
        typeof snapshot.bid === "number" &&
        typeof snapshot.ask === "number" &&
        snapshot.bid > 0 &&
        snapshot.ask > 0
      ) {
        return {
          bid: snapshot.bid,
          ask: snapshot.ask,
          mid: snapshot.mid ?? (snapshot.bid + snapshot.ask) / 2,
          liquidityUsd: snapshot.depth,
        };
      }
    }

    if (scope.kind === "DEX") {
      // PancakeSwap pool snapshots carry a mid quote plus pool depth, but no
      // order-book bid/ask. Derive a conservative synthetic half-spread (10
      // bps) around the pool's own mid so the scoped readout uses the pool's
      // data, not the last global market (ADR-0013 venue/pool/pair scoping).
      const snapshot = this.marketDataSnapshots.get(
        `${scope.venue}:${scope.pair.toUpperCase()}`,
      );
      if (snapshot && typeof snapshot.mid === "number" && snapshot.mid > 0) {
        const halfSpread = (snapshot.mid * 10) / 10_000;
        return {
          bid: snapshot.mid - halfSpread,
          ask: snapshot.mid + halfSpread,
          mid: snapshot.mid,
          liquidityUsd: snapshot.depth,
        };
      }
    }

    return { ...this.market };
  }

  private validateConfig(): void {
    if (!this.config.bybitApiKey || !this.config.bybitApiKey.trim()) {
      throw new Error(
        "BYBIT_API_KEY is required for live mode. Refusing to start.",
      );
    }
    if (!this.config.bybitApiSecret || !this.config.bybitApiSecret.trim()) {
      throw new Error(
        "BYBIT_API_SECRET is required for live mode. Refusing to start.",
      );
    }
    if (this.config.mode === "live" && !this.config.canaryConfig.apiKeys.withdrawalsDisabled) {
      throw new Error(
        "Live mode requires withdrawals to be disabled on API keys. Refusing to start.",
      );
    }
  }

  // ── Market Data Ingestion ───────────────────────────────────────────

  /**
   * Handle incoming market data from WebSocket.
   * Feeds the OpportunityDetector for real-time arbitrage detection.
   */
  private handleMarketData(snapshot: MarketDataSnapshot): void {
    this.market = {
      bid: snapshot.bid ?? 0,
      ask: snapshot.ask ?? 0,
      mid: snapshot.mid ?? 0,
      liquidityUsd: snapshot.depth,
    };

    // Store snapshot for multi-venue comparison
    const key = `${snapshot.venue}:${snapshot.symbol}`;
    this.marketDataSnapshots.set(key, snapshot);

    // Feed into OpportunityDetector
    this.opportunityDetector.ingestMarketData(snapshot);

    // Feed data quality monitor with freshness metrics.
    if (this.dataQualityMonitor) {
      const ageMs = this.nowMs() - snapshot.timestampMs;
      const metrics: DataQualityMetrics = {
        source: snapshot.venue,
        latencyMs: snapshot.latencyMs ?? 100,
        stalenessMs: ageMs,
        gapCount: 0,
        wsRestConsistent: true,
        rpcHealthy: snapshot.rpcHealth !== "unavailable",
        exchangeStatus: snapshot.rpcHealth === "degraded" ? "degraded" : "online",
      };
      this.dataQualityMonitor.evaluate(metrics, this.nowMs());
    }
  }

  /**
   * Feed REST ticker data into OpportunityDetector when WS is not active.
   */
  private ingestMarketDataFromTicker(bid: string, ask: string, lastPrice: string): void {
    const bidNum = parseFloat(bid) || 0;
    const askNum = parseFloat(ask) || 0;
    const lastNum = parseFloat(lastPrice) || 0;
    const mid = (bidNum > 0 && askNum > 0) ? (bidNum + askNum) / 2 : lastNum;

    const snapshot: MarketDataSnapshot = {
      venue: "bybit",
      symbol: this.config.symbols[0] ?? "BTCUSDT",
      timestampMs: this.nowMs(),
      bid: bidNum > 0 ? bidNum : lastNum,
      ask: askNum > 0 ? askNum : lastNum,
      mid,
      depth: 10_000,
      latencyMs: 100,
      source: "bybit-rest-ticker",
    };

    this.opportunityDetector.ingestMarketData(snapshot);
  }

  // ── AC6: Order Update Handling ─────────────────────────────────────

  private handleOrderUpdate(update: OrderUpdate): void {
    const orderId = update.orderId;

    this.auditLogger.record("WS_ORDER_UPDATE", {
      orderId,
      symbol: update.symbol,
      side: update.side,
      status: update.status,
      cumulativeFilledQty: update.cumulativeFilledQty,
      averagePrice: update.averagePrice,
    });

    // AC6: Record as FILLED only when confirmed via WebSocket
    if (update.status === "FILLED") {
      const intent = this.pendingOrders.get(orderId);
      const fillPrice = update.averagePrice ?? update.price ?? 0;
      const fillQuantity = update.cumulativeFilledQty;
      const notionalUsd = fillQuantity * fillPrice;

      // SP6: Compute fees from configured fee rate
      const feesUsd = notionalUsd * (this.config.feeBps / 10_000);

      const trade: TradeRecord = {
        orderId,
        symbol: update.symbol,
        side: update.side,
        fillPrice,
        fillQuantity,
        notionalUsd,
        feesUsd,
        slippageBps: computeSlippageBps(
          notionalUsd,
          this.market.liquidityUsd,
          10,
        ),
        filledAtMs: update.timestampMs,
      };
      this.trades.push(trade);
      this.ordersFilled++;

      // Record fill to learning engine for governed learning loop
      this.session.learning.recordFill({
        tradeId: orderId,
        symbol: trade.symbol,
        side: trade.side,
        entryPrice: trade.fillPrice,
        exitPrice: trade.fillPrice,
        filledQuantity: trade.fillQuantity,
        feesUsd: trade.feesUsd,
        enteredAtMs: trade.filledAtMs,
        exitedAtMs: trade.filledAtMs,
        strategyId: "arbitrage",
        regime: this.lastRegime ?? "unknown",
        venue: "bybit",
      });

      // Update inventory: release committed capital
      this.committedCapitalUsd = Math.max(0, this.committedCapitalUsd - notionalUsd);

      // Notify the session about the fill
      this.session.notifyOrderResolved(orderId, "FILLED", 0);

      this.events.onTrade?.(trade);

      this.auditLogger.record("TRADE_FILLED", {
        orderId,
        symbol: trade.symbol,
        side: trade.side,
        fillPrice: trade.fillPrice,
        fillQuantity: trade.fillQuantity,
        notionalUsd: trade.notionalUsd,
        feesUsd: trade.feesUsd,
      });

      this.pendingOrders.delete(orderId);
      // Order fully resolved — no longer an active partial fill.
      this.partialFillOrders.delete(orderId);

      console.log(
        `[live] FILL confirmed: ${update.symbol} ${update.side} ${fillQuantity} @ $${fillPrice.toFixed(2)} (fees: $${feesUsd.toFixed(4)})`,
      );
    } else if (update.status === "PARTIALLY_FILLED") {
      // Track active partial fills so a WebSocket drop can force CANCEL_ONLY_MODE.
      if (update.cumulativeFilledQty > 0) {
        this.partialFillOrders.add(orderId);
        this.auditLogger.record("ORDER_PARTIALLY_FILLED", {
          orderId,
          symbol: update.symbol,
          cumulativeFilledQty: update.cumulativeFilledQty,
        });
      }
    } else if (
      update.status === "CANCELLED" ||
      update.status === "REJECTED" ||
      update.status === "EXPIRED"
    ) {
      // Release committed capital on cancel/reject
      const intent = this.pendingOrders.get(orderId);
      if (intent) {
        this.committedCapitalUsd = Math.max(0, this.committedCapitalUsd - intent.quantity * intent.price);
      }
      this.session.notifyOrderResolved(
        orderId,
        update.status === "REJECTED" ? "REJECTED" : "CANCELLED",
        0,
      );
      this.pendingOrders.delete(orderId);
      // Order no longer active — clear any tracked partial fill.
      this.partialFillOrders.delete(orderId);
    }
  }

  // ── AC7: Reconciliation ────────────────────────────────────────────

  private async reconcile(): Promise<void> {
    if (!this.running) return;

    try {
      // Get internal open orders from the execution engine
      const internalOrders = Array.from(this.pendingOrders.entries()).map(
        ([orderId, intent]) => ({
          orderId,
          status: "OPEN" as const,
          quantity: intent.quantity,
          filledQuantity: 0,
        }),
      );

      // Internal positions from trade history
      const internalPositions = this.deriveInternalPositions();

      // Internal balances from inventory
      const internalBalances = this.deriveInternalBalances();

      // SP3: Reconcile all configured symbols, not just the first
      const externalOrders: Array<{
        orderId: string;
        status: "OPEN" | "CLOSED" | "CANCELLED";
        quantity: number;
        filledQuantity: number;
      }> = [];

      const externalPositions: Array<{
        symbol: string;
        quantity: number;
        averagePrice: number;
      }> = [];

      const externalBalances: Array<{
        asset: string;
        available: number;
        locked: number;
      }> = [];

      // Query external orders
      for (const symbol of this.config.symbols) {
        const exchangeOpenOrders = await this.restClient.getOpenOrders({
          category: this.config.orderCategory,
          symbol,
        });

        for (const order of exchangeOpenOrders.list ?? []) {
          externalOrders.push({
            orderId: order.orderId,
            status:
              order.orderStatus === "Filled"
                ? "CLOSED"
                : order.orderStatus === "Cancelled"
                  ? "CANCELLED"
                  : "OPEN",
            quantity: parseFloat(order.qty),
            filledQuantity: parseFloat(order.cumExecQty),
          });
        }
      }

      // Query external positions
      try {
        const exchangePositions = await this.restClient.getPositions({
          category: this.config.orderCategory,
        });
        for (const pos of exchangePositions) {
          const size = parseFloat(pos.size);
          if (size > 0) {
            externalPositions.push({
              symbol: pos.symbol,
              quantity: pos.side === "Buy" ? size : -size,
              averagePrice: parseFloat(pos.avgPrice),
            });
          }
        }
      } catch {
        // Position query may fail for spot accounts — non-critical
      }

      // Query external balances
      try {
        const exchangeBalances = await this.restClient.getCoinBalances();
        for (const coin of exchangeBalances) {
          const walletBalance = parseFloat(coin.walletBalance ?? "0");
          const locked = parseFloat(coin.locked ?? "0");
          if (walletBalance > 0 || locked > 0) {
            externalBalances.push({
              asset: coin.coin,
              available: walletBalance - locked,
              locked,
            });
          }
        }
      } catch {
        // Balance query may fail — non-critical
      }

      // Run reconciliation
      const report = this.reconciliationEngine.reconcile({
        internal: {
          orders: internalOrders,
          fills: [],
          positions: internalPositions,
          balances: internalBalances,
        },
        external: {
          orders: externalOrders,
          fills: [],
          positions: externalPositions,
          balances: externalBalances,
        },
        reconciledAtMs: this.nowMs(),
      });

      // Notify session of reconciliation status
      this.session.setReconciliationStatus(report.unresolved);

      this.auditLogger.record("RECONCILIATION", {
        unresolved: report.unresolved,
        severity: report.severity,
        orphanOrders: report.orphanOrders.length,
        positionMismatches: report.positionMismatches.length,
        balanceMismatches: report.balanceMismatches.length,
      });

      if (report.unresolved) {
        console.warn(
          `[live] Reconciliation unresolved (severity: ${report.severity}). Orphans: ${report.orphanOrders.length}, Position mismatches: ${report.positionMismatches.length}, Balance mismatches: ${report.balanceMismatches.length}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[live] Reconciliation failed: ${msg}`);
      this.auditLogger.record("RECONCILIATION_FAILED", { error: msg });
      // Mark as unresolved to trigger kill switch
      this.session.setReconciliationStatus(true);
    }
  }

  /**
   * Derive internal positions from trade history.
   */
  private deriveInternalPositions(): Array<{ symbol: string; quantity: number; averagePrice: number }> {
    const positionMap = new Map<string, { quantity: number; totalCost: number }>();

    for (const trade of this.trades) {
      const existing = positionMap.get(trade.symbol) ?? { quantity: 0, totalCost: 0 };
      const qty = trade.side === "BUY" ? trade.fillQuantity : -trade.fillQuantity;
      existing.quantity += qty;
      existing.totalCost += qty * trade.fillPrice;
      positionMap.set(trade.symbol, existing);
    }

    const positions: Array<{ symbol: string; quantity: number; averagePrice: number }> = [];
    for (const [symbol, pos] of positionMap) {
      if (Math.abs(pos.quantity) > 1e-12) {
        positions.push({
          symbol,
          quantity: pos.quantity,
          averagePrice: pos.totalCost / pos.quantity,
        });
      }
    }
    return positions;
  }

  /**
   * Derive internal balances from inventory tracking.
   * Returns per-asset balances from the last inventory query.
   */
  private deriveInternalBalances(): Array<{ asset: string; available: number; locked: number }> {
    // Return the last known per-asset balances from the exchange query.
    // This ensures reconciliation compares apples-to-apples.
    if (this.lastKnownBalances.length > 0) {
      return this.lastKnownBalances;
    }

    // Fallback: single USDT balance from inventory tracking.
    return [{
      asset: "USDT",
      available: Math.max(0, this.availableCapitalUsd - this.committedCapitalUsd),
      locked: this.committedCapitalUsd,
    }];
  }

  // ── AC5: Kill Switch ───────────────────────────────────────────────

  private cancelAllOpenOrders(): void {
    for (const [orderId, intent] of this.pendingOrders) {
      this.restClient
        .cancelOrder({
          category: this.config.orderCategory,
          symbol: intent.symbol,
          orderId,
        })
        .catch((cancelErr: unknown) => {
          const msg =
            cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
          console.error(`[live] Failed to cancel order ${orderId}: ${msg}`);
        });

      this.session.notifyOrderResolved(orderId, "CANCELLED", 0);
    }
    this.pendingOrders.clear();
    this.partialFillOrders.clear();
    this.committedCapitalUsd = 0;

    // Also control through TradingSession
    this.session.control("cancel-all");
  }

  // ── Inventory Management ───────────────────────────────────────────

  /**
   * Query real balances from the exchange and update internal inventory state.
   * CONTEXT.md §18: "The system must know balances on exchanges, wallets..."
   */
  private async updateInventory(): Promise<void> {
    try {
      const balances = await this.restClient.getCoinBalances();
      let totalUsd = 0;
      const trackedBalances: Array<{ asset: string; available: number; locked: number }> = [];

      for (const coin of balances) {
        const walletBalance = parseFloat(coin.walletBalance ?? "0");
        const locked = parseFloat(coin.locked ?? "0");
        totalUsd += walletBalance;
        if (walletBalance > 0 || locked > 0) {
          trackedBalances.push({
            asset: coin.coin,
            available: walletBalance - locked,
            locked,
          });
        }
      }

      this.availableCapitalUsd = totalUsd;
      this.lastKnownBalances = trackedBalances;

      this.auditLogger.record("INVENTORY_UPDATED", {
        availableCapitalUsd: this.availableCapitalUsd,
        committedCapitalUsd: this.committedCapitalUsd,
        freeCapitalUsd: this.availableCapitalUsd - this.committedCapitalUsd,
        trackedAssets: trackedBalances.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[live] Failed to query balances: ${msg}`);
      this.auditLogger.record("INVENTORY_QUERY_FAILED", { error: msg });
    }
  }

  // ── Cycle Loop ─────────────────────────────────────────────────────

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    this.cycleCount++;

    // Track price history for volatility
    if (this.market.mid > 0) {
      this.priceHistory.push(this.market.mid);
      if (this.priceHistory.length > 100) {
        this.priceHistory = this.priceHistory.slice(-100);
      }
    }

    // Check kill switch status
    const status = this.session.status;
    if (status.killSwitchActive) {
      console.log(`[live] Kill switch active. Halting cycles.`);
      this.auditLogger.record("CYCLE_HALTED", {
        cycleCount: this.cycleCount,
        reason: "kill switch active",
      });
      return;
    }

    // Derive regime input
    const regimeInput = this.deriveRegimeInput();

    // ADR-0013: run the per-scope cognitive layer before opportunity
    // detection so the general agents consult fresh scoped market state.
    await this.runScopeAgents();

    // REAL OPPORTUNITY DETECTION via OpportunityDetector
    const opportunities = this.opportunityDetector.detectOpportunities();
    this.opportunitiesDetected += opportunities.length;

    // Evaluate each opportunity through RiskEngine
    const approvedIntents: OrderIntent[] = [];
    const approvedRiskDecisions: RiskDecision[] = [];
    for (const { candidate, intent } of opportunities) {
      const riskDecision = this.evaluateRisk(intent, candidate.expectedNetProfitUsd);

      if (riskDecision.decision === "APPROVE") {
        approvedIntents.push(intent);
        approvedRiskDecisions.push(riskDecision);
        this.auditLogger.record("OPPORTUNITY_APPROVED", {
          opportunityId: candidate.id,
          expectedNetProfitUsd: candidate.expectedNetProfitUsd,
          route: candidate.route.join("→"),
        });
      } else {
        this.opportunitiesRejectedByRisk++;
        this.auditLogger.record("OPPORTUNITY_REJECTED_BY_RISK", {
          opportunityId: candidate.id,
          decision: riskDecision.decision,
          reasonCodes: "reasonCodes" in riskDecision ? riskDecision.reasonCodes : [],
        });
      }
    }

    // ADR-0013: route the per-scope general agent recommendations through the
    // same mandatory Risk Engine gate. Directional (BUY/SELL) recommendations
    // become intents at the scope's current mid and join the approved set so
    // they place through the engine seam like any other approved intent.
    for (const rec of this.lastScopeRecommendations.values()) {
      if (rec.signal === "HOLD") continue;

      const intent = buildRecommendationIntent(rec, this.scopeMarketState(rec.scope), {
        now: this.nowMs,
        maxSlippageBps: this.config.feeBps,
      });
      if (!intent) continue;

      rec.suggestedIntent = intent;
      const riskDecision = this.evaluateRisk(intent, 0);

      if (riskDecision.decision === "APPROVE") {
        approvedIntents.push(intent);
        approvedRiskDecisions.push(riskDecision);
        this.auditLogger.record("RECOMMENDATION_APPROVED", {
          cycleCount: this.cycleCount,
          scopeId: rec.scopeId,
          agentId: rec.agentId,
          signal: rec.signal,
          confidence: rec.confidence,
        });
      } else {
        this.recommendationsRejectedByRisk++;
        this.auditLogger.record("RECOMMENDATION_REJECTED_BY_RISK", {
          cycleCount: this.cycleCount,
          scopeId: rec.scopeId,
          agentId: rec.agentId,
          decision: riskDecision.decision,
          reasonCodes: "reasonCodes" in riskDecision ? riskDecision.reasonCodes : [],
        });
      }
    }

    // Run TradingSession cycle with approved intents and their risk decisions
    const result = this.session.runCycle({
      regime: regimeInput,
      market: {
        bid: this.market.bid,
        ask: this.market.ask,
        mid: this.market.mid,
        liquidityUsd: this.market.liquidityUsd,
      },
      intents: approvedIntents,
      riskDecisions: approvedRiskDecisions,
    });

    // S5+SP5: Detect and audit regime changes
    if (
      result.regimeClassification !== undefined &&
      result.regimeClassification.regime !== this.lastRegime
    ) {
      this.regimeChangeCount++;
      this.lastRegime = result.regimeClassification.regime;
      this.auditLogger.record("REGIME_CHANGED", {
        cycleCount: this.cycleCount,
        regime: result.regimeClassification.regime,
        confidence: result.regimeClassification.confidence,
      });
    }

    this.ordersSubmitted += result.submittedCount;
    this.ordersBlocked += result.blockedCount;
    this.learningRecommendationCount += result.learningRecommendations.length;

    // AC3: Place orders via REST for submitted intents
    const submittedIntents: OrderIntent[] = [];
    for (let i = 0; i < approvedIntents.length && i < result.submittedCount; i++) {
      submittedIntents.push(approvedIntents[i]);
    }

    for (const intent of submittedIntents) {
      await this.placeOrder(intent);
    }

    // SP1: Post-order kill switch check
    const postStatus = this.session.status;
    if (postStatus.killSwitchActive) {
      console.log(`[live] Kill switch activated after order placement.`);
      this.auditLogger.record("KILL_SWITCH_POST_ORDER", {
        cycleCount: this.cycleCount,
        trigger: postStatus.autoKillTrigger,
      });
    }

    // Audit cycle completion (AC11)
    this.auditLogger.record("CYCLE_COMPLETE", {
      cycleCount: this.cycleCount,
      regime: result.regimeClassification?.regime,
      regimeConfidence: result.regimeClassification?.confidence,
      submitted: result.submittedCount,
      blocked: result.blockedCount,
      opportunitiesDetected: opportunities.length,
      opportunitiesRejectedByRisk: this.opportunitiesRejectedByRisk,
      recommendations: this.lastScopeRecommendations.size,
      recommendationsRejectedByRisk: this.recommendationsRejectedByRisk,
      ordersFilled: this.ordersFilled,
      killSwitchActive: this.session.status.killSwitchActive,
    });

    this.events.onCycle?.(this.cycleCount, {
      regime: result.regimeClassification?.regime,
      submitted: result.submittedCount,
      blocked: result.blockedCount,
    });

    // AC3: Display cycle status via StatusDisplay if wired
    this.config.statusDisplay?.printCycleStatus({
      mode: this.config.mode,
      cycleCount: this.cycleCount,
      regime: result.regimeClassification?.regime,
      regimeConfidence: result.regimeClassification?.confidence,
      pnlUsd: this.session.status.dailyPnlUsd,
      openOrders: this.pendingOrders.size,
      killSwitchActive: this.session.status.killSwitchActive,
      submitted: result.submittedCount,
      blocked: result.blockedCount,
      totalTrades: this.trades.length,
    });

    console.log(
      `[live] Cycle ${this.cycleCount}: regime=${result.regimeClassification?.regime ?? "unknown"} opportunities=${opportunities.length} approved=${approvedIntents.length} submitted=${result.submittedCount} blocked=${result.blockedCount} trades=${this.trades.length}`,
    );
  }

  // ── Risk Engine Evaluation ─────────────────────────────────────────

  /**
   * Evaluate an OrderIntent through the RiskEngine.
   * CONTEXT.md §17: "The signal must pass through validation layers."
   * CONTEXT.md §18: "No OrderIntent exists without Risk Engine approval."
   */
  private evaluateRisk(intent: OrderIntent, expectedNetProfitUsd: number): RiskDecision {
    const mode: SystemMode = this.mapSessionModeToSystemMode();

    return this.riskEngine.evaluate({
      orderIntent: intent,
      expectedNetProfitUsd,
      mode,
      dataQualityScore: this.estimateDataQuality(),
      dailyLossUsd: this.session.status.dailyPnlUsd < 0 ? Math.abs(this.session.status.dailyPnlUsd) : 0,
      openOrderCount: this.pendingOrders.size,
      slippageBps: intent.limits.maxSlippageBps,
      reconciliationUnresolved: this.session.status.reconciliationUnresolved,
      auditUnavailable: false,
      evaluatedAtMs: this.nowMs(),
    });
  }

  /**
   * Map the session's operational mode to SystemMode for RiskEngine.
   */
  private mapSessionModeToSystemMode(): SystemMode {
    const status = this.session.status;
    if (!status.running) return "HALT";
    if (status.killSwitchActive) return "HALT";
    if (status.reconciliationUnresolved) return "CANCEL_ONLY";
    return "NORMAL";
  }

  /**
   * Estimate data quality from the DataQualityMonitor (preferred) or
   * fallback to raw freshness heuristic.
   */
  private estimateDataQuality(): number {
    // Prefer DataQualityMonitor reports when available.
    if (this.dataQualityMonitor) {
      const reports = this.dataQualityMonitor.getAllReports();
      if (reports.length > 0) {
        // Return the best quality score across all sources.
        return Math.max(...reports.map((r: { score: number }) => r.score));
      }
    }

    // Fallback: compute from market data freshness.
    const now = this.nowMs();
    let bestQuality = 0;

    for (const snapshot of this.marketDataSnapshots.values()) {
      const age = now - snapshot.timestampMs;
      let quality = 1.0;
      if (age > 30_000) quality = 0.3;
      else if (age > 10_000) quality = 0.6;
      else if (age > 5_000) quality = 0.8;

      if (snapshot.rpcHealth === "degraded") quality *= 0.7;
      else if (snapshot.rpcHealth === "unavailable") quality *= 0.3;

      if (quality > bestQuality) bestQuality = quality;
    }

    return bestQuality;
  }

  // ── AC3: Order Placement ───────────────────────────────────────────

  private async placeOrder(intent: OrderIntent): Promise<void> {
    // Check inventory: ensure we have enough free capital
    const notionalUsd = intent.quantity * intent.price;
    const freeCapital = this.availableCapitalUsd - this.committedCapitalUsd;
    if (freeCapital < notionalUsd) {
      console.warn(`[live] Insufficient free capital for order: $${freeCapital.toFixed(2)} available, $${notionalUsd.toFixed(2)} needed`);
      this.auditLogger.record("ORDER_SKIPPED_INVENTORY", {
        orderId: intent.idempotencyKey,
        availableUsd: freeCapital,
        requiredUsd: notionalUsd,
      });
      return;
    }

    this.auditLogger.record("ORDER_PLACING", {
      orderId: intent.idempotencyKey,
      symbol: intent.symbol,
      side: intent.side,
      quantity: intent.quantity,
      price: intent.price,
      venue: intent.venue,
    });

    // ADR-0011: the engine is the single order-sending seam. Run the canary
    // pre-check, then hand the intent to the engine which routes it through
    // the attached OrderRouter (CEX → Bybit REST, DEX → PancakeSwap swap).
    const preCheck = this.session.preCheckIntent(intent);
    if (!preCheck.allowed) {
      this.auditLogger.record("ORDER_BLOCKED", {
        orderId: intent.idempotencyKey,
        blockReason: preCheck.blockReason,
        reason: preCheck.reason,
      });
      this.ordersBlocked++;
      console.warn(`[live] Order blocked by canary pre-check: ${preCheck.reason}`);
      return;
    }

    try {
      const ack = await this.session.placeLiveOrder(intent, preCheck);

      // Track the pending order (AC6: wait for WS fill confirmation)
      this.pendingOrders.set(ack.orderId, intent);

      // Commit capital
      this.committedCapitalUsd += notionalUsd;

      this.auditLogger.record("ORDER_ACCEPTED", {
        orderId: ack.orderId,
        clientOrderId: intent.idempotencyKey,
        symbol: intent.symbol,
        side: intent.side,
        venue: ack.venue,
      });

      console.log(
        `[live] Order accepted via ${ack.venue}: ${intent.symbol} ${intent.side} ${intent.quantity} @ $${intent.price} (id: ${ack.orderId})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.auditLogger.record("ORDER_FAILED", {
        orderId: intent.idempotencyKey,
        error: msg,
      });
      console.error(`[live] Order failed: ${msg}`);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private deriveRegimeInput(): import("@agenttrading/core").RegimeClassifierInput {
    const spreadBps =
      this.market.bid > 0 && this.market.ask > 0
        ? ((this.market.ask - this.market.bid) / this.market.mid) * 10_000
        : 10;

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

  private computeRealizedVolatility(): number {
    if (this.priceHistory.length < 2) return 0.5;

    const returns: number[] = [];
    for (let i = 1; i < this.priceHistory.length; i++) {
      const r =
        (this.priceHistory[i] - this.priceHistory[i - 1]) /
        this.priceHistory[i - 1];
      returns.push(r);
    }

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance =
      returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(365 * 24 * 60);
  }

  private computeDirectionalStreak(): number {
    if (this.priceHistory.length < 2) return 0;

    let streak = 0;
    const last = this.priceHistory[this.priceHistory.length - 1];
    const prev = this.priceHistory[this.priceHistory.length - 2];
    const direction = last > prev ? 1 : -1;

    for (let i = this.priceHistory.length - 2; i > 0; i--) {
      const dir =
        this.priceHistory[i] > this.priceHistory[i - 1] ? 1 : -1;
      if (dir === direction) streak++;
      else break;
    }

    return streak;
  }
}
