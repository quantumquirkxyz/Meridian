/**
 * Binance connector: normalizes Binance API data into MarketDataSnapshot.
 *
 * This enables CEX-CEX arbitrage by providing price data from Binance
 * that the OpportunityDetector can compare with Bybit prices.
 */

import type { MarketDataSnapshot } from "@agenttrading/contracts";
import { BinanceRESTClient } from "./binance-rest.ts";

export interface BinanceConnectorConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}

/**
 * Build a MarketDataSnapshot from Binance ticker data.
 */
export function buildBinanceSnapshot(
  ticker: { symbol: string; bidPrice: string; askPrice: string; lastPrice: string },
  source = "binance-rest",
): MarketDataSnapshot {
  const bid = parseFloat(ticker.bidPrice) || 0;
  const ask = parseFloat(ticker.askPrice) || 0;
  const last = parseFloat(ticker.lastPrice) || 0;
  const mid = (bid > 0 && ask > 0) ? (bid + ask) / 2 : (last || 0);

  return {
    venue: "binance",
    symbol: normalizeSymbol(ticker.symbol),
    timestampMs: Date.now(),
    bid: bid > 0 ? bid : last,
    ask: ask > 0 ? ask : last,
    mid,
    depth: 0,
    latencyMs: 100,
    source,
  };
}

/**
 * Normalize Binance symbol format (e.g., "BTCUSDT" -> "BTC/USDT").
 */
function normalizeSymbol(symbol: string): string {
  const quotes = ["USDT", "USDC", "BTC", "ETH", "DAI", "BUSD", "TUSD"];
  for (const quote of quotes) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return `${symbol.slice(0, -quote.length)}/${quote}`;
    }
  }
  return symbol;
}

export { BinanceRESTClient };
