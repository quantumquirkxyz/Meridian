import type { MarketDataSnapshot } from "@agenttrading/contracts";

export interface BybitMarketDataInput {
  symbol: string;
  bid?: number | null;
  ask?: number | null;
  depth?: number;
  exchangeTimestampMs?: number;
  receiveTimestampMs: number;
  processingTimestampMs?: number;
  source?: string;
  sequence?: number;
  venue?: string;
}

const BYBIT_QUOTE_SUFFIXES = ["USDT", "USDC", "BTC", "ETH", "SOL", "BNB", "USD"] as const;

function splitBybitSymbol(symbol: string): [string, string] {
  const normalized = symbol.toUpperCase().replace(/[-_]/g, "");
  const slash = symbol.includes("/") ? symbol.toUpperCase().split("/") : null;
  if (slash && slash.length === 2) {
    return [slash[0], slash[1]];
  }

  for (const suffix of BYBIT_QUOTE_SUFFIXES) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      return [normalized.slice(0, -suffix.length), suffix];
    }
  }

  return [normalized, ""];
}

export function normalizeBybitSymbol(symbol: string): string {
  const [base, quote] = splitBybitSymbol(symbol);
  return quote ? `${base}/${quote}` : base;
}

export function buildBybitMarketDataSnapshot(
  input: BybitMarketDataInput,
): MarketDataSnapshot {
  const bid = input.bid ?? null;
  const ask = input.ask ?? null;
  const timestampMs = input.exchangeTimestampMs ?? input.receiveTimestampMs;
  const latencyMs = Math.max(0, input.receiveTimestampMs - timestampMs);

  return {
    venue: input.venue ?? "bybit",
    symbol: normalizeBybitSymbol(input.symbol),
    timestampMs,
    bid,
    ask,
    mid: bid !== null && ask !== null ? (bid + ask) / 2 : null,
    depth: input.depth ?? 0,
    latencyMs,
    source: input.source ?? "bybit-ws",
    sequence: input.sequence,
  };
}

export function measureBybitClockDriftMs(input: BybitMarketDataInput): number {
  const exchangeTimestampMs = input.exchangeTimestampMs ?? input.receiveTimestampMs;
  const processingTimestampMs = input.processingTimestampMs ?? input.receiveTimestampMs;
  return processingTimestampMs - exchangeTimestampMs;
}
