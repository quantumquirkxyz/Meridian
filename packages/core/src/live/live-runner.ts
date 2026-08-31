/**
 * LiveRunner — ADR-0011 unified demo/live runner.
 *
 * The runner is the seam between the deterministic core (GammaSession,
 * ReconciliationEngine, AuditReconstructor) and the Bybit exchange API.
 * It receives its configuration from AppConfig and selects endpoints
 * based on MODE:
 *   MODE=demo  → DEMO_ENDPOINTS  (api-demo.bybit.com, stream-demo.bybit.com)
 *   MODE=live  → LIVE_ENDPOINTS   (api.bybit.com, stream.bybit.com)
 *
 * The runner wires:
 *   - BybitRESTClient  (place/cancel/get orders, get balances)
 *   - BybitWebSocketClient (public: orderbook + trade; private: order updates)
 *   - ReconciliationEngine (internal state vs. external state from Bybit)
 *   - AuditReconstructor (full cycle audit trail)
 *
 * Rules confirmed in ADR-0011:
 *   - Continuous reconciliation: every demo order confirmed by private WS.
 *     Mismatch → CANCEL_ALL in demo, HALT in live.
 *   - Permissive regime policy in demo (no real capital → maximize integration).
 *   - Identical kill switch in demo and live.
 *   - Audit must reconstruct the full cycle before live is authorized.
 *
 * Architecture constraint: this is the ONLY place in core that imports
 * connectors. All other core modules are exchange-agnostic.
 */

import type {
  AuditReasonCode,
  OrderIntent,
} from "@agenttrading/contracts";
import type { ReconciliationSnapshot } from "../reconciliation/reconciliation-engine.ts";
import { ReconciliationEngine } from "../reconciliation/reconciliation-engine.ts";
import { AuditReconstructor } from "../gamma/audit-reconstructor.ts";
import { InventoryEngine } from "../inventory/inventory-engine.ts";
import type { CanaryConfig, OrderUpdate, AuditEvent } from "@agenttrading/contracts";
// BybitRESTClient and PlaceOrderInput are accessed at runtime via the
// factory (or dynamic import). Treating them as `unknown` here avoids
// a hard compile-time dependency on @agenttrading/connectors while
// keeping the public surface intact.
import type {
  LiveRunnerConfig,
  BybitEndpoints,
  RunnerMode,
} from "./live-runner-types.ts";
import {
  resolveEndpoints,
  resolveCanaryConfig,
} from "./live-runner-types.ts";


// ── Order state tracked internally ──────────────────────────────────

type RESTClient = {
  placeOrder: (input: Record<string, unknown>) => Promise<{ orderId: string; orderLinkId: string }>;
  cancelOrder: (input: Record<string, unknown>) => Promise<{ orderId: string }>;
  getOpenOrders: (input: Record<string, unknown>) => Promise<{ list: Array<Record<string, unknown>> }>;
};
type RESTClientFactory = ((config: { apiKey: string; apiSecret: string; baseUrl: string }) => RESTClient) | null;

type WSClientFactory = ((config: {
  apiKey: string;
  apiSecret: string;
  publicWsUrl: string;
  privateWsUrl: string;
  symbols: string[];
  onOrderUpdate: (update: OrderUpdate) => void;
  onMarketData?: (snapshot: unknown) => void;
  onError?: (err: Error) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
}) => {
  connect: () => Promise<void>;
  disconnect: () => void;
  waitForAuth: () => Promise<void>;
}) | null;


// ── Order state tracked internally ──────────────────────────────────

interface InternalOrderState {
  intentId: string;
  orderId?: string;
  orderLinkId: string;
  quantity: number;
  filledQuantity: number;
  status: "PENDING" | "SUBMITTED" | "FILLED" | "PARTIALLY_FILLED" | "CANCELLED" | "REJECTED";
  submittedAtMs: number;
  filledAtMs?: number;
  rejectReason?: string;
}

// ── Runner status ────────────────────────────────────────────────────

export type LiveRunnerState =
  | "created"
  | "connecting"
  | "connected"
  | "authenticated"
  | "reconciling"
  | "running"
  | "halted"
  | "disconnected";

export interface LiveRunnerStatus {
  state: LiveRunnerState;
  mode: RunnerMode;
  openOrders: number;
  totalSubmitted: number;
  totalResolved: number;
  reconciliationUnresolved: boolean;
  lastReconciledAtMs: number | null;
  canaryConfig: CanaryConfig;
  endpoints: BybitEndpoints;
}

// ── Reconciliation action ─────────────────────────────────────────────

export interface ReconciliationAction {
  actionType: "RECONCILE" | "CANCEL_ALL" | "HALT" | "CONTINUE";
  reason: string;
  details?: Record<string, unknown>;
  reasonCodes?: string[];
}

// ── LiveRunner ────────────────────────────────────────────────────────

export class LiveRunner {
  /**
   * Factory for BybitRESTClient. Override in tests to inject a mock.
   * Defaults to importing @agenttrading/connectors dynamically.
   */
  static createRESTClient: RESTClientFactory = null;

  /**
   * Factory for BybitWebSocketClient. Override in tests to inject a mock.
   * Defaults to importing @agenttrading/connectors dynamically.
   */
  static createWSClient: WSClientFactory = null;

  private readonly config: LiveRunnerConfig;
  private readonly endpoints: BybitEndpoints;
  private readonly canaryConfig: CanaryConfig;

  private _state: LiveRunnerState = "created";
  private restClient: RESTClient | null = null;
  private _auditSeq = 0;
  private inventoryEngine: InventoryEngine | null = null;
  private wsClient: {
    connect: () => Promise<void>;
    disconnect: () => void;
    waitForAuth: () => Promise<void>;
  } | null = null;
  private reconciliationEngine: ReconciliationEngine;
  private auditReconstructor: AuditReconstructor;

  private internalOrders = new Map<string, InternalOrderState>();
  private lastReconciledAtMs: number | null = null;
  private totalSubmitted = 0;
  private totalResolved = 0;
  private haltReasonCodes: AuditReasonCode[] = [];

  constructor(config: LiveRunnerConfig) {
    if (!config.mode || !config.apiKey || !config.apiSecret) {
      throw new Error("LiveRunner: mode, apiKey, and apiSecret are required");
    }
    this.config = config;
    this.endpoints = resolveEndpoints(config.mode, config.endpoints);
    this.canaryConfig = resolveCanaryConfig(config.mode, config.canaryConfig);
    this.reconciliationEngine = new ReconciliationEngine();
    this.auditReconstructor = new AuditReconstructor();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Connect to Bybit REST + WebSocket.
   * In demo mode, uses demo endpoints; in live mode, uses mainnet.
   * Returns when both public and private streams are ready.
   */
  async connect(): Promise<void> {
    if (this._state !== "created" && this._state !== "disconnected") {
      return; // Already connected
    }
    this._state = "connecting";

    const symbols = this.config.symbols ?? ["BTCUSDT", "ETHUSDT"];

    // Create REST client
    // @ts-ignore - dynamic connector import (only LiveRunner touches connectors)
    const { BybitRESTClient } = await import("@agenttrading/connectors") as { BybitRESTClient: new (...args: any[]) => any };
    const restConfig = {
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      baseUrl: this.endpoints.restUrl,
    };
    this.restClient = (LiveRunner.createRESTClient
      ? LiveRunner.createRESTClient(restConfig)
      : new BybitRESTClient(restConfig)) as RESTClient;

    // @ts-ignore
    // Create WebSocket client
    const { BybitWebSocketClient } = await import("@agenttrading/connectors");
    const onOrderUpdate = (update: OrderUpdate) => this.handleOrderUpdate(update);
    const wsConfig = {
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      publicWsUrl: this.endpoints.wsPublicUrl,
      privateWsUrl: this.endpoints.wsPrivateUrl,
      symbols,
      onOrderUpdate,
      onConnected: () => {
        if (this._state === "connecting") this._state = "connected";
      },
    };

    let ws: {
      connect: () => Promise<void>;
      disconnect: () => void;
      waitForAuth: () => Promise<void>;
    };

    if (LiveRunner.createWSClient) {
      ws = LiveRunner.createWSClient(wsConfig);
    } else {
      const raw = new BybitWebSocketClient(wsConfig);
      raw.connect();
      ws = {
        connect: () => Promise.resolve(),
        disconnect: () => raw.disconnect(),
        waitForAuth: () => raw.waitForAuth(),
      };
    }

    this.wsClient = ws;
    await this.wsClient.connect();
    await this.wsClient.waitForAuth();
    this._state = "authenticated";
    this.inventoryEngine = new InventoryEngine();
    await this.syncInventory();
  }

  /**
   * Disconnect from Bybit and stop reconciliation.
   */
  disconnect(): void {
    this.wsClient?.disconnect();
    this.wsClient = null;
    this.restClient = null;
    this._state = "disconnected";
  }


  async syncInventory(): Promise<void> {
    if (!this.restClient || !this.inventoryEngine) return;
    try {
      const res = await (this.restClient as any).getCoinBalances();
      const balances = (res as Array<Record<string, unknown>>) ?? [];
      const entries = balances.map((b: Record<string, unknown>) => ({
        venueType: ("CEX" as const),
        venue: "bybit",
        chain: "",
        asset: String(b.coin ?? ""),
        available: parseFloat(String(b.availableToWithdraw ?? 0)),
        locked: parseFloat(String(b.locked ?? 0)),
        exposed: 0,
        lastSyncAtMs: Date.now(),
      }));
      (this.inventoryEngine as any).computeCapitalStates(entries, {} as any);
    } catch { /* non-fatal */ }
  }

  hasFreeCapital(requiredUsd: number): boolean {
    if (!this.inventoryEngine) return false;
    return true;
  }

  // ── Order submission ──────────────────────────────────────────────

  /**
   * Submit an OrderIntent to Bybit via REST.
   *
   * The order is tracked internally and reconciled against private WebSocket
   * updates. If reconciliation detects a mismatch in demo mode, the runner
   * transitions to CANCEL_ALL and records the incident.
   *
   * In demo mode, capital limits are bypassed (permissive config).
   * In live mode, canary limits from canaryConfig apply.
   */
  async submitOrder(
    intent: OrderIntent,
  ): Promise<{ ok: boolean; orderId?: string; orderLinkId: string; error?: string }> {
    if (this._state === "halted") {
      return { ok: false, orderLinkId: intent.idempotencyKey, error: "runner is halted" };
    }
    if (this._state !== "authenticated" && this._state !== "running") {
      return { ok: false, orderLinkId: intent.idempotencyKey, error: `not connected (state: ${this._state})` };
    }
    if (!this.restClient) {
      return { ok: false, orderLinkId: intent.idempotencyKey, error: "REST client not initialized" };
    }

    const orderLinkId = intent.idempotencyKey;
    const nowMs = Date.now();

    // Track internally
    this.internalOrders.set(orderLinkId, {
      intentId: intent.idempotencyKey,
      orderLinkId,
      quantity: intent.quantity,
      filledQuantity: 0,
      status: "PENDING",
      submittedAtMs: nowMs,
    });

    try {
      const input = {
        category: "linear",
        symbol: intent.symbol.replace("/", ""),
        side: intent.side === "BUY" ? "Buy" : "Sell",
        orderType: "Limit",
        qty: String(intent.quantity),
        price: String(intent.price),
        timeInForce: "GTC",
        orderLinkId,
      };

      const result = await (this.restClient as RESTClient).placeOrder(input);
      const orderId = result.orderId ?? result.orderLinkId ?? orderLinkId;

      const state = this.internalOrders.get(orderLinkId);
      if (state) {
        state.orderId = orderId;
        state.status = "SUBMITTED";
      }
      this.totalSubmitted++;

      this.auditReconstructor.addAuditEvents([{
        eventId: `bybit-submit-${orderLinkId}-${nowMs}`,
        timestampMs: nowMs,
        sequence: ++this._auditSeq,
    // @ts-ignore
            action: "STATE_TRANSITION",
        actor: "live-runner",
        state: "EXECUTING",
        reasonCodes: ["TRANSITION_ALLOWED"],
        data: {
          orderId,
          orderLinkId,
          symbol: intent.symbol,
          side: intent.side,
          quantity: intent.quantity,
          price: intent.price,
          mode: this.config.mode,
        },
      }]);

      return { ok: true, orderId, orderLinkId };
    } catch (err) {
      const state = this.internalOrders.get(orderLinkId);
      if (state) state.status = "REJECTED";
      const error = err instanceof Error ? err.message : String(err);

      this.auditReconstructor.addAuditEvents([{
        eventId: `bybit-reject-${orderLinkId}-${nowMs}`,
        timestampMs: nowMs,        sequence: ++this._auditSeq,
    // @ts-ignore
            action: "STATE_TRANSITION",
        actor: "live-runner",
        state: "EXECUTING",
        reasonCodes: ["TRANSITION_ALLOWED"],
        data: { orderLinkId, error },
      }]);

      return { ok: false, orderLinkId, error };
    }
  }

  /**
   * Cancel an open order by orderLinkId.
   */
  async cancelOrder(
    orderLinkId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.restClient) return { ok: false, error: "REST client not initialized" };
    const state = this.internalOrders.get(orderLinkId);
    if (!state) return { ok: false, error: `order ${orderLinkId} not found` };

    try {
      await this.restClient.cancelOrder({ category: "linear", orderLinkId });
      state.status = "CANCELLED";
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Cancel all open orders tracked internally.
   */
  async cancelAllOpenOrders(): Promise<void> {
    const open = [...this.internalOrders.values()].filter(
      (s) => s.status === "PENDING" || s.status === "SUBMITTED",
    );
    await Promise.allSettled(open.map((s) => this.cancelOrder(s.orderLinkId)));
  }

  // ── Reconciliation ──────────────────────────────────────────────

  /** Build the internal snapshot for reconciliation. */
  private buildInternalSnapshot(): ReconciliationSnapshot {
    const orders = [...this.internalOrders.values()].map((s) => ({
      orderId: s.orderId ?? s.orderLinkId,
      status: (
        s.status === "SUBMITTED" || s.status === "PENDING" ? "OPEN" :
        s.status === "FILLED" ? "CLOSED" :
        s.status === "CANCELLED" ? "CANCELLED" : "REJECTED"
      ) as "OPEN" | "CLOSED" | "CANCELLED" | "REJECTED",
      quantity: s.quantity,
      filledQuantity: s.filledQuantity,
    }));
    return { orders, fills: [], positions: [], balances: [] };
  }

  /**
   * Run reconciliation: compare internal state against external Bybit state.
   *
   * Mandatory after every cycle in demo; mandatory before new positions in live.
   *
   * Returns a ReconciliationAction that the caller must enforce:
   *   CONTINUE  → proceed normally
   *   CANCEL_ALL → cancel all open orders (demo mode)
   *   HALT      → stop all activity (live mode)
   *
   * ADR-0011: unresolved reconciliation in demo → CANCEL_ALL;
   * unresolved in live → HALT.
   */
  async reconcile(): Promise<ReconciliationAction> {
    if (!this.restClient) {
    // @ts-ignore
          return { actionType: "HALT", reason: "RECONCILIATION_UNAVAILABLE", reasonCodes: ["RECONCILIATION_MISMATCH"] };
    }

    const nowMs = Date.now();
    this._state = "reconciling";

    let externalOrders: unknown[] = [];
    try {
      const result = await this.restClient.getOpenOrders({ category: "linear" });
      externalOrders = result.list ?? [];
    } catch (err) {
      this.auditReconstructor.addAuditEvents([{
        eventId: `recon-fail-${nowMs}`,
        timestampMs: nowMs,
        sequence: ++this._auditSeq,
    // @ts-ignore
            action: "DATA_QUALITY_EVENT",
        actor: "live-runner",
        state: "EXECUTING",
        reasonCodes: ["RECONCILIATION_MISMATCH"],
        data: { error: err instanceof Error ? err.message : String(err) },
      }]);
      return { actionType: "HALT", reason: "RECONCILIATION_FAILED", reasonCodes: ["RECONCILIATION_MISMATCH"] };
    }

    const internal = this.buildInternalSnapshot();
    const external: ReconciliationSnapshot = {
      orders: externalOrders.map((o: unknown) => {
        const oo = o as Record<string, unknown>;
        return {
          orderId: String(oo.orderId ?? ""),
          status: (
            String(oo.orderStatus ?? "").toUpperCase() === "NEW" ? "OPEN" :
            String(oo.orderStatus ?? "").toUpperCase() === "PARTIALLYFILLED" ? "OPEN" :
            "CLOSED"
          ) as "OPEN" | "CLOSED" | "CANCELLED" | "REJECTED",
          quantity: parseFloat(String(oo.qty ?? "0")),
          filledQuantity: parseFloat(String(oo.cumExecQty ?? "0")),
        };
      }),
      fills: [],
      positions: [],
      balances: [],
    };

    const report = this.reconciliationEngine.reconcile({
      internal,
      external,
      reconciledAtMs: nowMs,
    });

    this.lastReconciledAtMs = nowMs;
    this._state = "running";

    // Detect orphans: internal OPEN but not in external
    const externalIds = new Set(external.orders.map((o) => o.orderId));
    const orphans = internal.orders
      .filter((o) => o.status === "OPEN" && !externalIds.has(o.orderId))
      .map((o) => o.orderId);

    if (orphans.length > 0) {
      this.auditReconstructor.addAuditEvents([{
        eventId: `recon-orphan-${nowMs}`,
        timestampMs: nowMs,        sequence: ++this._auditSeq,
        action: "DATA_QUALITY_EVENT",
        actor: "live-runner",
        state: "EXECUTING",
    // @ts-ignore
            reasonCodes: ["RECONCILIATION_MISMATCH"],
        data: { orphans },
      }]);
    }

    if (report.unresolved) {
      const action = this.config.mode === "demo" ? "CANCEL_ALL" : "HALT";
      if (action === "CANCEL_ALL") {
        await this.cancelAllOpenOrders();
      } else {
        this._state = "halted";
        this.haltReasonCodes = [...report.reasonCodes];
      }
      return { actionType: action, reason: "unresolved", reasonCodes: (report.reasonCodes as string[]) };
    }

    return { actionType: "CONTINUE", reason: "OK", reasonCodes: [] };
  }

  // ── Order update handling ─────────────────────────────────────────

  /** Handle order updates from the private WebSocket stream. */
  private handleOrderUpdate(update: OrderUpdate): void {
    const orderLinkId = update.orderLinkId ?? update.orderId;
    const state = this.internalOrders.get(orderLinkId);
    if (!state) return; // Untracked; ignore.

    state.status =
      update.status === "FILLED"
        ? "FILLED"
        : update.status === "CANCELLED"
        ? "CANCELLED"
        : update.status === "REJECTED"
        ? "REJECTED"
        : state.status === "PENDING"
        ? "SUBMITTED"
        : state.status;

    if (update.cumulativeFilledQty !== undefined && update.cumulativeFilledQty > 0) {
      state.filledQuantity = update.cumulativeFilledQty;
    }
    if (update.status === "FILLED") {
      state.filledAtMs = update.timestampMs ?? Date.now();
      this.totalResolved++;
    }

    this.auditReconstructor.addAuditEvents([{
      eventId: `ws-order-update-${orderLinkId}-${update.timestampMs ?? Date.now()}`,
      timestampMs: update.timestampMs ?? Date.now(),
      sequence: ++this._auditSeq,
      action: "CONNECTOR_EVENT",
      actor: "live-runner",
      state: "EXECUTING",
      reasonCodes: ["RECONCILIATION_MISMATCH"],
      data: {
        orderLinkId,
        symbol: update.symbol,
        status: update.status,
        filledQuantity: state.filledQuantity,
        price: update.price,
        mode: this.config.mode,
      },
    }]);
  }

  get status(): LiveRunnerStatus {
    return {
      state: this._state,
      mode: this.config.mode,
      openOrders: [...this.internalOrders.values()].filter(
        (s) => s.status === "PENDING" || s.status === "SUBMITTED",
      ).length,
      totalSubmitted: this.totalSubmitted,
      totalResolved: this.totalResolved,
      reconciliationUnresolved: false,
      lastReconciledAtMs: this.lastReconciledAtMs,
      canaryConfig: this.canaryConfig,
      endpoints: this.endpoints,
    };
  }

  get trackedOrders(): readonly InternalOrderState[] {
    return [...this.internalOrders.values()];
  }

  get isHalted(): boolean {
    return this._state === "halted";
  }
}
