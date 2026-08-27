/**
 * BybitV5RESTClient: REST client for the Bybit V5 unified API.
 *
 * Features:
 * - HMAC-SHA256 signing per Bybit V5 spec (timestamp + apiKey + recvWindow + queryString)
 * - Place/cancel order, get account info, get open orders
 * - Rate limit handling with exponential backoff on 429
 * - Configurable testnet vs mainnet base URL
 *
 * All methods work; API keys are passed through even in demo
 * mode so the signing logic can be validated offline. Actual request
 * dispatch is mockable via the `fetchFn` constructor parameter.
 */

import { createHmac } from "node:crypto";
import {
  type BybitApiResponse,
  type BybitCancelOrderResult,
  type BybitCoinBalance,
  type BybitOpenOrdersResult,
  type BybitOrderSide,
  type BybitPlaceOrderResult,
  type BybitTimeInForce,
  type BybitWalletBalanceResult,
} from "./bybit-types.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface BybitRESTClientConfig {
  /** API key. */
  apiKey: string;
  /** API secret. */
  apiSecret: string;
  /** Base URL. Defaults to mainnet. */
  baseUrl?: string;
  /** Default recv_window in ms. Defaults to 5000. */
  recvWindow?: number;
  /** Max retries on 429. Defaults to 3. */
  maxRetries?: number;
  /** Initial backoff ms for 429 retry. Defaults to 1000. */
  initialBackoffMs?: number;
  /** Custom fetch function (for testing). */
  fetchFn?: typeof fetch;
}

export interface PlaceOrderInput {
  category: "spot" | "linear" | "inverse" | "option";
  symbol: string;
  side: BybitOrderSide;
  orderType: "Market" | "Limit";
  qty: string;
  price?: string;
  timeInForce?: BybitTimeInForce;
  orderLinkId?: string;
  reduceOnly?: boolean;
  closeOnTrigger?: boolean;
  /** Stop-loss trigger price. */
  stopLoss?: string;
  /** Take-profit trigger price. */
  takeProfit?: string;
}

export interface CancelOrderInput {
  category: "spot" | "linear" | "inverse" | "option";
  symbol: string;
  orderId?: string;
  orderLinkId?: string;
}

export interface GetOpenOrdersInput {
  category: "spot" | "linear" | "inverse" | "option";
  symbol?: string;
  orderId?: string;
  orderLinkId?: string;
  orderStatus?: string;
  limit?: number;
  cursor?: string;
}

// ── Rate limit state ─────────────────────────────────────────────────

interface RateLimitState {
  /** Remaining requests. */
  remaining: number;
  /** Reset timestamp (Unix ms). */
  resetMs: number;
  /** Maximum requests per window. */
  maxRequests: number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://api.bybit.com";
const DEFAULT_RECV_WINDOW = 5_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1_000;

// ── Client ───────────────────────────────────────────────────────────

export class BybitRESTClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly recvWindow: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly fetchFn: typeof fetch;

  private rateLimit: RateLimitState = {
    remaining: 120,
    resetMs: 0,
    maxRequests: 120,
  };

  constructor(config: BybitRESTClientConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.recvWindow = config.recvWindow ?? DEFAULT_RECV_WINDOW;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs = config.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Place a new order.
   * POST /v5/order/create
   */
  async placeOrder(input: PlaceOrderInput): Promise<BybitPlaceOrderResult> {
    const params: Record<string, string> = {
      category: input.category,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      qty: input.qty,
    };
    if (input.price !== undefined) params.price = input.price;
    if (input.timeInForce !== undefined) params.timeInForce = input.timeInForce;
    if (input.orderLinkId !== undefined) params.orderLinkId = input.orderLinkId;
    if (input.reduceOnly !== undefined) params.reduceOnly = String(input.reduceOnly);
    if (input.closeOnTrigger !== undefined) params.closeOnTrigger = String(input.closeOnTrigger);
    if (input.stopLoss !== undefined) params.stopLoss = input.stopLoss;
    if (input.takeProfit !== undefined) params.takeProfit = input.takeProfit;

    const result = await this.privateRequest<BybitPlaceOrderResult>(
      "POST",
      "/v5/order/create",
      params,
    );
    return result;
  }

  /**
   * Cancel an order by orderId or orderLinkId.
   * POST /v5/order/cancel
   */
  async cancelOrder(input: CancelOrderInput): Promise<BybitCancelOrderResult> {
    const params: Record<string, string> = {
      category: input.category,
      symbol: input.symbol,
    };
    if (input.orderId !== undefined) params.orderId = input.orderId;
    if (input.orderLinkId !== undefined) params.orderLinkId = input.orderLinkId;

    const result = await this.privateRequest<BybitCancelOrderResult>(
      "POST",
      "/v5/order/cancel",
      params,
    );
    return result;
  }

  /**
   * Get open orders for a category.
   * GET /v5/order/realtime
   */
  async getOpenOrders(input: GetOpenOrdersInput): Promise<BybitOpenOrdersResult> {
    const params: Record<string, string> = {
      category: input.category,
    };
    if (input.symbol !== undefined) params.symbol = input.symbol;
    if (input.orderId !== undefined) params.orderId = input.orderId;
    if (input.orderLinkId !== undefined) params.orderLinkId = input.orderLinkId;
    if (input.orderStatus !== undefined) params.orderStatus = input.orderStatus;
    if (input.limit !== undefined) params.limit = String(input.limit);
    if (input.cursor !== undefined) params.cursor = input.cursor;

    const result = await this.privateRequest<BybitOpenOrdersResult>(
      "GET",
      "/v5/order/realtime",
      params,
    );
    return result;
  }

  /**
   * Get wallet balance.
   * GET /v5/account/wallet-balance
   */
  async getAccountInfo(): Promise<BybitWalletBalanceResult> {
    const result = await this.privateRequest<BybitWalletBalanceResult>(
      "GET",
      "/v5/account/wallet-balance",
      { accountType: "unified" },
    );
    return result;
  }

  /**
   * Get coin balances from the unified account.
   */
  async getCoinBalances(): Promise<BybitCoinBalance[]> {
    const wallet = await this.getAccountInfo();
    const account = wallet.list[0];
    return account?.coin ?? [];
  }

  /**
   * Get the current rate limit state.
   */
  getRateLimitState(): Readonly<RateLimitState> {
    return { ...this.rateLimit };
  }

  // ── Internal HTTP methods ───────────────────────────────────────

  private async privateRequest<T>(
    method: "GET" | "POST",
    endpoint: string,
    params: Record<string, string>,
  ): Promise<T> {
    const payload = new URLSearchParams(params).toString();
    return this.requestWithRetry<T>(method, endpoint, payload);
  }

  private async requestWithRetry<T>(
    method: "GET" | "POST",
    endpoint: string,
    payload: string,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // Respect rate limit: wait until reset if exhausted
      if (this.rateLimit.remaining <= 0) {
        const waitMs = Math.max(0, this.rateLimit.resetMs - Date.now());
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }

      try {
        const result = await this.makeRequest<T>(method, endpoint, payload);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Only retry on rate limit (429)
        if (!isRateLimitError(err) || attempt >= this.maxRetries) {
          throw lastError;
        }

        const backoffMs = this.calculateBackoff(attempt);
        await sleep(backoffMs);
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  private async makeRequest<T>(
    method: "GET" | "POST",
    endpoint: string,
    payload: string,
  ): Promise<T> {
    const timestamp = Date.now();
    const signPayload = `${timestamp}${this.apiKey}${this.recvWindow}${payload}`;
    const signature = createHmac("sha256", this.apiSecret)
      .update(signPayload)
      .digest("hex");

    const url = new URL(endpoint, this.baseUrl);

    const headers: Record<string, string> = {
      "X-BAPI-API-KEY": this.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-TIMESTAMP": String(timestamp),
      "X-BAPI-RECV-Window": String(this.recvWindow),
      "Content-Type": "application/x-www-form-urlencoded",
    };

    const init: RequestInit = { method, headers };
    if (method === "POST") {
      init.body = payload;
    } else if (payload) {
      url.search = payload;
    }

    const response = await this.fetchFn(url.toString(), init);

    // Update rate limit state from response headers
    this.updateRateLimit(response);

    if (response.status === 429) {
      throw new BybitRateLimitError(
        `Rate limited: ${response.status}`,
        response.status,
      );
    }

    const body = (await response.json()) as BybitApiResponse<T>;

    if (body.retCode !== 0) {
      throw new BybitAPIError(
        `Bybit API error ${body.retCode}: ${body.retMsg}`,
        body.retCode,
        body.retMsg,
      );
    }

    return body.result;
  }

  private calculateBackoff(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, capped at 30s
    const base = this.initialBackoffMs * Math.pow(2, attempt);
    return Math.min(base, 30_000);
  }

  private updateRateLimit(response: Response): void {
    const remaining = response.headers.get("X-Rate-Limit-Remaining");
    const reset = response.headers.get("X-Rate-Limit-Reset");
    const limit = response.headers.get("X-Rate-Limit-Limit");

    if (remaining !== null) {
      this.rateLimit.remaining = parseInt(remaining, 10) || 0;
    }
    if (reset !== null) {
      this.rateLimit.resetMs = parseInt(reset, 10) * 1000 || Date.now();
    }
    if (limit !== null) {
      this.rateLimit.maxRequests = parseInt(limit, 10) || 120;
    }
  }
}

// ── Errors ───────────────────────────────────────────────────────────

export class BybitAPIError extends Error {
  constructor(
    message: string,
    public readonly retCode: number,
    public readonly retMsg: string,
  ) {
    super(message);
    this.name = "BybitAPIError";
  }
}

export class BybitRateLimitError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "BybitRateLimitError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function isRateLimitError(err: unknown): boolean {
  return err instanceof BybitRateLimitError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
