/**
 * BinanceV3RESTClient: REST client for the Binance V3 API.
 *
 * Features:
 * - HMAC-SHA256 signing per Binance spec
 * - Get account balances, open orders, ticker prices
 * - Rate limit handling
 * - Configurable testnet vs mainnet base URL
 *
 * This connector enables CEX-CEX arbitrage by providing price data
 * from a second venue (Binance) in addition to Bybit.
 */

import { createHmac } from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────

export interface BinanceRESTClientConfig {
  /** API key. */
  apiKey: string;
  /** API secret. */
  apiSecret: string;
  /** Base URL. Defaults to mainnet. */
  baseUrl?: string;
  /** Default recv_window in ms. Defaults to 5000. */
  recvWindow?: number;
  /** Custom fetch function (for testing). */
  fetchFn?: typeof fetch;
}

export interface BinanceTicker {
  symbol: string;
  bidPrice: string;
  askPrice: string;
  lastPrice: string;
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccountResult {
  balances: BinanceBalance[];
}

export interface BinanceOpenOrder {
  symbol: string;
  orderId: number;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  side: string;
  type: string;
}

// ── Constants ────────────────────────────────────────────────────────

export const BINANCE_MAINNET_URL = "https://api.binance.com";
export const BINANCE_TESTNET_URL = "https://testnet.binance.vision";
const DEFAULT_RECV_WINDOW = 5_000;

// ── Client ───────────────────────────────────────────────────────────

export class BinanceRESTClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly recvWindow: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: BinanceRESTClientConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl ?? BINANCE_MAINNET_URL;
    this.recvWindow = config.recvWindow ?? DEFAULT_RECV_WINDOW;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  /**
   * Get ticker price for a symbol.
   * GET /api/v3/ticker/bookTicker
   */
  async getTicker(symbol: string): Promise<BinanceTicker> {
    const params = new URLSearchParams({ symbol }).toString();
    const result = await this.requestWithRetry<{
      symbol?: string;
      bidPrice?: string;
      askPrice?: string;
      lastPrice?: string;
    }>("GET", "/api/v3/ticker/bookTicker", params);
    return {
      symbol: result.symbol ?? symbol,
      bidPrice: result.bidPrice ?? "0",
      askPrice: result.askPrice ?? "0",
      lastPrice: result.lastPrice ?? "0",
    };
  }

  /**
   * Get account balances.
   * GET /api/v3/account
   */
  async getAccountInfo(): Promise<BinanceAccountResult> {
    const params = new URLSearchParams({
      timestamp: String(Date.now()),
      recvWindow: String(this.recvWindow),
    }).toString();
    const result = await this.privateRequest<BinanceAccountResult>("GET", "/api/v3/account", params);
    return result;
  }

  /**
   * Get non-zero balances from account.
   */
  async getBalances(): Promise<BinanceBalance[]> {
    const account = await this.getAccountInfo();
    return account.balances.filter(
      (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0,
    );
  }

  /**
   * Get open orders for a symbol.
   * GET /api/v3/openOrders
   */
  async getOpenOrders(symbol?: string): Promise<BinanceOpenOrder[]> {
    const params = new URLSearchParams({
      timestamp: String(Date.now()),
      recvWindow: String(this.recvWindow),
    });
    if (symbol) params.set("symbol", symbol);
    const result = await this.privateRequest<BinanceOpenOrder[]>("GET", "/api/v3/openOrders", params.toString());
    return result;
  }

  // ── Internal HTTP methods ───────────────────────────────────────

  private async privateRequest<T>(
    method: "GET" | "POST",
    endpoint: string,
    payload: string,
  ): Promise<T> {
    const signature = createHmac("sha256", this.apiSecret)
      .update(payload)
      .digest("hex");

    const sep = payload.includes("?") ? "&" : "?";
    const signedPayload = `${payload}${sep}signature=${signature}`;

    return this.requestWithRetry<T>(method, endpoint, signedPayload);
  }

  private async requestWithRetry<T>(
    method: "GET" | "POST",
    endpoint: string,
    payload: string,
  ): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);

    const headers: Record<string, string> = {
      "X-MBX-APIKEY": this.apiKey,
    };

    const init: RequestInit = { method, headers };
    if (method === "POST") {
      init.body = payload;
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (payload) {
      url.search = payload;
    }

    const response = await this.fetchFn(url.toString(), init);

    if (response.status === 429) {
      throw new BinanceRateLimitError(`Rate limited: ${response.status}`, response.status);
    }

    const body = (await response.json()) as { code?: number; msg?: string; [key: string]: unknown };

    if (body.code && body.code < 0) {
      throw new BinanceAPIError(
        `Binance API error ${body.code}: ${body.msg}`,
        body.code,
        body.msg ?? "",
      );
    }

    return body as T;
  }
}

// ── Errors ───────────────────────────────────────────────────────────

export class BinanceAPIError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly msg: string,
  ) {
    super(message);
    this.name = "BinanceAPIError";
  }
}

export class BinanceRateLimitError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "BinanceRateLimitError";
  }
}
