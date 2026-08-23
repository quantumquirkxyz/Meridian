/**
 * BybitV5WebSocketClient: WebSocket client for Bybit V5 streams.
 *
 * Features:
 * - Public streams (orderbook, trade) for configured symbols
 * - Private streams (order, position, execution) with HMAC auth
 * - Automatic ping/pong keepalive (20s interval)
 * - Reconnection on disconnect with exponential backoff (1s→2s→4s→8s→max 30s)
 * - Normalizes raw WS events into MarketDataSnapshot and OrderUpdate
 */

import { createHmac } from "node:crypto";
import {
  buildBybitMarketDataSnapshot,
  normalizeBybitSymbol,
  type BybitMarketDataInput,
} from "./bybit.ts";
import type {
  BybitOrderbookData,
  BybitTradeData,
  BybitWSTopic,
  BybitWSOrderData,
  BybitWSOpMessage,
  BybitWSResponse,
} from "./bybit-types.ts";
import type { MarketDataSnapshot } from "@agenttrading/contracts";
import type { OrderUpdate, OrderUpdateSide, OrderUpdateStatus, OrderUpdateType } from "@agenttrading/contracts";

// ── Types ────────────────────────────────────────────────────────────

export type BybitWSState = "disconnected" | "connecting" | "connected" | "authenticating";

export interface BybitWebSocketClientConfig {
  /** API key (required for private streams). */
  apiKey?: string;
  /** API secret (required for private streams). */
  apiSecret?: string;
  /** Public stream URL. */
  publicWsUrl?: string;
  /** Private stream URL. */
  privateWsUrl?: string;
  /** Symbols to subscribe to on public streams. */
  symbols?: string[];
  /** Public topics to subscribe to. Defaults to orderbook.50 and trade. */
  publicTopics?: string[];
  /** Private topics to subscribe to. Defaults to order, position, execution. */
  privateTopics?: string[];
  /** Custom WebSocket constructor (for testing). */
  wsFactory?: (url: string) => WebSocketLike;
  /** Custom clock for testing (returns current time in ms). */
  nowMs?: () => number;
}

export interface BybitWSClientEvents {
  onMarketData?: (snapshot: MarketDataSnapshot) => void;
  onOrderUpdate?: (update: OrderUpdate) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onError?: (error: Error) => void;
  onReconnecting?: (attempt: number) => void;
}

// ── WebSocketLike interface ──────────────────────────────────────────

interface WebSocketLike {
  readyState: number;
  close(): void;
  send(data: string | ArrayBuffer): void;
  addEventListener(type: string, handler: (event: unknown) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_PUBLIC_WS_URL = "wss://stream.bybit.com/v5/public/linear";
const DEFAULT_PRIVATE_WS_URL = "wss://stream.bybit.com/v5/private";
const DEFAULT_TESTNET_PUBLIC_WS_URL = "wss://stream-testnet.bybit.com/v5/public/linear";
const DEFAULT_TESTNET_PRIVATE_WS_URL = "wss://stream-testnet.bybit.com/v5/private";
const PING_INTERVAL_MS = 20_000;
const WS_OPEN = 1;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = Infinity;

// ── Client ───────────────────────────────────────────────────────────

export class BybitWebSocketClient {
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly publicWsUrl: string;
  private readonly privateWsUrl: string;
  private readonly symbols: string[];
  private readonly publicTopics: string[];
  private readonly privateTopics: string[];
  private readonly wsFactory: (url: string) => WebSocketLike;
  private readonly nowMs: () => number;

  private events: BybitWSClientEvents = {};
  private publicWs: WebSocketLike | null = null;
  private privateWs: WebSocketLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private authenticated = false;
  private authPromiseResolve: (() => void) | null = null;
  private authPromiseReject: ((err: Error) => void) | null = null;
  private _state: BybitWSState = "disconnected";

  /** Current client state. */
  get state(): BybitWSState {
    return this._state;
  }

  /** Whether the private stream is authenticated. */
  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  constructor(config: BybitWebSocketClientConfig = {}) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.publicWsUrl = config.publicWsUrl ?? DEFAULT_PUBLIC_WS_URL;
    this.privateWsUrl = config.privateWsUrl ?? DEFAULT_PRIVATE_WS_URL;
    this.symbols = config.symbols ?? [];
    this.publicTopics = config.publicTopics ?? ["orderbook.50", "trade"];
    this.privateTopics = config.privateTopics ?? ["order", "position", "execution"];
    this.wsFactory = config.wsFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.nowMs = config.nowMs ?? (() => Date.now());
  }

  /**
   * Register event handlers. Must be called before connect().
   */
  on(events: BybitWSClientEvents): void {
    this.events = { ...this.events, ...events };
  }

  /**
   * Connect to public and private WebSocket streams.
   * If API keys are provided, authenticates the private stream.
   */
  async connect(): Promise<void> {
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.authenticated = false;
    this._state = "connecting";

    // Connect public stream
    this.publicWs = this.createAndBindWs(this.publicWsUrl, "public");
    this.startPingTimer();

    // Connect private stream if API keys provided
    if (this.apiKey && this.apiSecret) {
      this.privateWs = this.createAndBindWs(this.privateWsUrl, "private");
    }
  }

  /**
   * Disconnect all streams and stop reconnection.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this._state = "disconnected";
    this.stopPingTimer();
    this.clearReconnectTimer();

    if (this.publicWs) {
      this.publicWs.close();
      this.publicWs = null;
    }
    if (this.privateWs) {
      this.privateWs.close();
      this.privateWs = null;
    }
    this.authenticated = false;
  }

  /**
   * Wait for the private stream to authenticate.
   * Rejects after timeout.
   */
  async waitForAuth(timeoutMs = 10_000): Promise<void> {
    if (this.authenticated) return;
    if (!this.privateWs) {
      throw new Error("No private WebSocket configured");
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Auth timed out"));
      }, timeoutMs);

      this.authPromiseResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.authPromiseReject = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  // ── Internal ────────────────────────────────────────────────────

  private createAndBindWs(url: string, stream: "public" | "private"): WebSocketLike {
    const ws = this.wsFactory(url);

    ws.addEventListener("open", () => {
      this._state = stream === "private" ? "authenticating" : "connected";

      if (stream === "public") {
        this.subscribePublicTopics();
        if (this.privateWs === null || this.authenticated) {
          this._state = "connected";
          this.events.onConnected?.();
        }
      }

      if (stream === "private") {
        this.authenticatePrivateStream();
      }
    });

    ws.addEventListener("message", (event: unknown) => {
      const raw = typeof event === "object" && event !== null && "data" in event
        ? String((event as { data: unknown }).data)
        : String(event);
      this.handleMessage(raw, stream);
    });

    ws.addEventListener("close", (event: unknown) => {
      const reason = typeof event === "object" && event !== null && "reason" in event
        ? String((event as { reason: unknown }).reason)
        : "closed";
      this._state = "disconnected";
      if (stream === "public") this.publicWs = null;
      if (stream === "private") {
        this.privateWs = null;
        this.authenticated = false;
      }
      this.events.onDisconnected?.(reason);
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (event: unknown) => {
      const msg = typeof event === "object" && event !== null && "message" in event
        ? String((event as { message: unknown }).message)
        : "ws error";
      this.events.onError?.(new Error(`WebSocket error (${stream}): ${msg}`));
    });

    return ws;
  }

  private subscribePublicTopics(): void {
    if (!this.publicWs || this.publicWs.readyState !== WS_OPEN) return;

    const args: string[] = [];
    for (const topic of this.publicTopics) {
      for (const symbol of this.symbols) {
        args.push(`${topic}.${symbol}`);
      }
    }

    if (args.length === 0) return;

    const msg: BybitWSOpMessage = { op: "subscribe", args: args as BybitWSTopic[] };
    this.publicWs.send(JSON.stringify(msg));
  }

  private authenticatePrivateStream(): void {
    if (!this.privateWs || this.privateWs.readyState !== WS_OPEN) return;
    if (!this.apiKey || !this.apiSecret) return;

    const expires = this.nowMs() + 10_000; // 10s from now
    const signPayload = `GET/realtime${expires}`;
    const signature = createHmac("sha256", this.apiSecret)
      .update(signPayload)
      .digest("hex");

    const authMsg = {
      op: "auth",
      args: [this.apiKey, expires, signature],
    };
    this.privateWs.send(JSON.stringify(authMsg));
  }

  private subscribePrivateTopics(): void {
    if (!this.privateWs || this.privateWs.readyState !== WS_OPEN) return;

    const msg: BybitWSOpMessage = {
      op: "subscribe",
      args: this.privateTopics as BybitWSTopic[],
    };
    this.privateWs.send(JSON.stringify(msg));
  }

  private handleMessage(raw: string, stream: "public" | "private"): void {
    let parsed: BybitWSResponse;
    try {
      parsed = JSON.parse(raw) as BybitWSResponse;
    } catch {
      return; // Ignore non-JSON messages
    }

    // Handle pong responses (keepalive ack)
    if (parsed.op === "pong") return;

    // Handle auth response
    if (parsed.op === "auth") {
      if (parsed.auth) {
        this.authenticated = true;
        this._state = "connected";
        this.subscribePrivateTopics();
        this.authPromiseResolve?.();
        this.authPromiseResolve = null;
        this.events.onConnected?.();
      } else {
        const err = new Error(`Auth failed: ${parsed.ret_msg ?? "unknown"}`);
        this.authPromiseReject?.(err);
        this.authPromiseReject = null;
        this.events.onError?.(err);
      }
      return;
    }

    // Handle subscription acks
    if (parsed.success !== undefined) return;

    // Handle data messages
    if (stream === "public") {
      this.handlePublicMessage(parsed);
    } else {
      this.handlePrivateMessage(parsed);
    }
  }

  private handlePublicMessage(msg: BybitWSResponse): void {
    const topic = msg.topic ?? "";
    const data = msg.data;

    if (topic.startsWith("orderbook.") && this.isOrderbookData(data)) {
      this.processOrderbookData(data);
    } else if (topic === "trade" && Array.isArray(data)) {
      for (const trade of data) {
        if (this.isTradeData(trade)) {
          this.processTradeData(trade);
        }
      }
    }
  }

  private handlePrivateMessage(msg: BybitWSResponse): void {
    const topic = msg.topic ?? "";
    const data = msg.data;

    if (topic === "order" && Array.isArray(data)) {
      for (const order of data) {
        if (this.isWSOrderData(order)) {
          this.processOrderUpdate(order);
        }
      }
    }
    // position and execution topics are received but not yet normalized
    // (they don't have a contracts type to map to yet)
  }

  // ── Orderbook normalization ────────────────────────────────────

  private isOrderbookData(data: unknown): data is BybitOrderbookData {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return typeof d.s === "string" && Array.isArray(d.b) && Array.isArray(d.a);
  }

  private processOrderbookData(data: BybitOrderbookData): void {
    const receiveTimestampMs = this.nowMs();
    const bid = data.b.length > 0 ? parseFloat(data.b[0].price) : null;
    const ask = data.a.length > 0 ? parseFloat(data.a[0].price) : null;

    let totalDepth = 0;
    for (const level of data.b) {
      totalDepth += parseFloat(level.size) * parseFloat(level.price);
    }
    for (const level of data.a) {
      totalDepth += parseFloat(level.size) * parseFloat(level.price);
    }

    const input: BybitMarketDataInput = {
      symbol: data.s,
      bid,
      ask,
      depth: totalDepth,
      exchangeTimestampMs: data.cts,
      receiveTimestampMs,
      source: "bybit-ws-orderbook",
      sequence: data.seq,
    };

    const snapshot = buildBybitMarketDataSnapshot(input);
    this.events.onMarketData?.(snapshot);
  }

  // ── Trade normalization ─────────────────────────────────────────

  private isTradeData(data: unknown): data is BybitTradeData {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return typeof d.s === "string" && typeof d.p === "string";
  }

  private processTradeData(data: BybitTradeData): void {
    const price = parseFloat(data.p);
    const receiveTimestampMs = this.nowMs();

    const input: BybitMarketDataInput = {
      symbol: data.s,
      bid: price,
      ask: price,
      exchangeTimestampMs: data.T,
      receiveTimestampMs,
      source: "bybit-ws-trade",
    };

    const snapshot = buildBybitMarketDataSnapshot(input);
    this.events.onMarketData?.(snapshot);
  }

  // ── Order update normalization ──────────────────────────────────

  private isWSOrderData(data: unknown): data is BybitWSOrderData {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return typeof d.orderId === "string" && typeof d.symbol === "string";
  }

  private processOrderUpdate(data: BybitWSOrderData): void {
    const update: OrderUpdate = {
      orderId: data.orderId,
      orderLinkId: data.orderLinkId || undefined,
      symbol: normalizeBybitSymbol(data.symbol),
      side: mapBybitSide(data.side),
      orderType: mapBybitOrderType(data.orderType),
      price: data.price ? parseFloat(data.price) : null,
      quantity: parseFloat(data.qty),
      status: mapBybitOrderStatus(data.orderStatus),
      cumulativeFilledQty: parseFloat(data.cumExecQty),
      leavesQty: parseFloat(data.leavesQty),
      averagePrice: data.avgPrice ? parseFloat(data.avgPrice) : null,
      timestampMs: data.updatedTime ? parseInt(data.updatedTime, 10) : this.nowMs(),
      stopOrderType: data.stopOrderType || undefined,
      tpslMode: data.tpslMode || undefined,
      triggerPrice: data.triggerPrice ? parseFloat(data.triggerPrice) : undefined,
      reason: data.rejectReason || data.cancelType || undefined,
    };

    this.events.onOrderUpdate?.(update);
  }

  // ── Ping/pong keepalive ────────────────────────────────────────

  private startPingTimer(): void {
    this.stopPingTimer();
    this.pingTimer = setInterval(() => {
      this.sendPing(this.publicWs, "public");
      this.sendPing(this.privateWs, "private");
    }, PING_INTERVAL_MS);
  }

  private stopPingTimer(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendPing(ws: WebSocketLike | null, stream: string): void {
    if (!ws || ws.readyState !== WS_OPEN) return;
    try {
      ws.send(JSON.stringify({ op: "ping" }));
    } catch {
      this.events.onError?.(new Error(`Failed to send ping (${stream})`));
    }
  }

  // ── Reconnection ──────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.clearReconnectTimer();

    const backoffMs = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempt++;

    this.events.onReconnecting?.(this.reconnectAttempt);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._state = "connecting";
      this.reconnect();
    }, backoffMs);
  }

  private async reconnect(): Promise<void> {
    try {
      // Re-create WebSocket connections
      if (this.symbols.length > 0 || this.publicTopics.length > 0) {
        this.publicWs = this.createAndBindWs(this.publicWsUrl, "public");
      }
      if (this.apiKey && this.apiSecret) {
        this.authenticated = false;
        this.privateWs = this.createAndBindWs(this.privateWsUrl, "private");
      }
    } catch (err) {
      this.events.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
      this.scheduleReconnect();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// ── Mapping helpers ──────────────────────────────────────────────────

function mapBybitSide(side: string): OrderUpdateSide {
  return side === "Buy" ? "BUY" : "SELL";
}

function mapBybitOrderType(type: string): OrderUpdateType {
  switch (type) {
    case "Market":
      return "MARKET";
    case "Limit":
      return "LIMIT";
    case "StopLimit":
      return "STOP_LIMIT";
    case "StopMarket":
      return "STOP_MARKET";
    case "TakeProfitLimit":
      return "TAKE_PROFIT_LIMIT";
    case "TakeProfitMarket":
      return "TAKE_PROFIT_MARKET";
    case "TrailingStopMarket":
      return "TRAILING_STOP_MARKET";
    default:
      return "LIMIT";
  }
}

function mapBybitOrderStatus(status: string): OrderUpdateStatus {
  switch (status) {
    case "New":
      return "NEW";
    case "PartiallyFilled":
      return "PARTIALLY_FILLED";
    case "Filled":
      return "FILLED";
    case "Cancelled":
      return "CANCELLED";
    case "Rejected":
      return "REJECTED";
    case "Deactivated":
      return "CANCELLED"; // Deactivated maps to cancelled
    case "Untriggered":
      return "UNTRIGGERED";
    default:
      return "NEW";
  }
}
