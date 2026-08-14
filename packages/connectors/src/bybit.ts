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

export function normalizeBybitSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase().replace(/[-_]/g, "/");
  return normalized.includes("/") ? normalized : `${normalized.slice(0, 3)}/${normalized.slice(3)}`;
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
