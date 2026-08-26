import type { MarketState } from "../utils/market-state.ts";

export type SyntheticMarketRegime = "trend" | "range" | "stress";

export interface SyntheticMarketSample extends MarketState {
  regime: SyntheticMarketRegime;
  shock: boolean;
  degraded: boolean;
}

export interface SyntheticMarketFeedOptions {
  symbols: string[];
  seed: number;
}

type Mulberry32 = () => number;

interface GeneratorState {
  regime: SyntheticMarketRegime;
  regimeAge: number;
  price: number;
  meanPrice: number;
  volatility: number;
  liquidityUsd: number;
  spreadBps: number;
  shockMemory: number;
}

/**
 * Seeded hybrid synthetic market feed for paper mode.
 *
 * The feed mixes regime switching, clustered volatility, occasional shocks,
 * and endogenous spread/liquidity changes. It is intentionally generic across
 * symbol sets: the symbol list only nudges the starting anchor and not any
 * asset-specific historical data.
 */
export class SyntheticMarketFeed {
  private readonly rng: Mulberry32;
  private readonly symbolFingerprint: number;
  private readonly state: GeneratorState;

  constructor(options: SyntheticMarketFeedOptions) {
    const seed = normalizeSeed(options.seed);
    this.rng = mulberry32(seed);
    this.symbolFingerprint = fingerprintSymbols(options.symbols);

    const basePrice = 100 + (this.symbolFingerprint % 7_500) / 25;
    this.state = {
      regime: "range",
      regimeAge: 0,
      price: basePrice,
      meanPrice: basePrice,
      volatility: 0.9,
      liquidityUsd: 9_500 + (this.symbolFingerprint % 2_500),
      spreadBps: 12,
      shockMemory: 0,
    };
  }

  next(): SyntheticMarketSample {
    this.transitionRegime();

    const shockRoll = this.rng();
    const shockProbability =
      this.state.regime === "stress" ? 0.14 : this.state.regime === "trend" ? 0.08 : 0.05;
    const shock = shockRoll < shockProbability;
    const shockDirection = this.rng() < 0.5 ? -1 : 1;
    const shockMagnitude = shock ? 0.02 + this.rng() * 0.08 : 0;

    // Volatility clustering: shocks and stressed regimes persist for a while.
    const targetVolatility =
      this.state.regime === "stress"
        ? 2.1
        : this.state.regime === "trend"
          ? 1.35
          : 0.8;
    const shockPulse = shock ? 2.5 + this.rng() * 3 : 0;
    this.state.volatility =
      0.82 * this.state.volatility +
      0.18 * targetVolatility +
      0.28 * this.state.shockMemory +
      shockPulse;
    this.state.shockMemory = Math.max(0, this.state.shockMemory * 0.72 + (shock ? 1 : 0));

    const meanReversion = (this.state.meanPrice - this.state.price) * 0.08;
    const drift =
      this.state.regime === "trend"
        ? 0.0015 + this.rng() * 0.001
        : this.state.regime === "stress"
          ? -0.0008 + this.rng() * 0.0006
          : 0;
    const noise = (this.rng() - 0.5) * this.state.volatility;
    const nextPrice = Math.max(
      1,
      this.state.price * (1 + drift + meanReversion / this.state.price + noise * 0.01 + shockDirection * shockMagnitude),
    );

    // Slowly adapt the reference mean to keep the walk bounded.
    this.state.meanPrice = 0.985 * this.state.meanPrice + 0.015 * nextPrice;
    this.state.price = nextPrice;

    const volatilityPressure = Math.min(4, this.state.volatility / 1.5);
    this.state.spreadBps = clamp(
      6 + volatilityPressure * 7 + (this.state.regime === "stress" ? 8 : 0) + (shock ? 10 : 0),
      4,
      80,
    );
    this.state.liquidityUsd = clamp(
      this.state.liquidityUsd * (0.975 + this.rng() * 0.02) -
        volatilityPressure * 140 -
        (shock ? 900 + this.rng() * 600 : 0),
      220,
      18_000,
    );

    const bid = Math.max(0.5, nextPrice * (1 - this.state.spreadBps / 20_000));
    const ask = nextPrice * (1 + this.state.spreadBps / 20_000);
    const degraded = this.state.liquidityUsd < 850 || this.state.spreadBps > 34;

    return {
      regime: this.state.regime,
      shock,
      degraded,
      bid,
      ask,
      mid: nextPrice,
      liquidityUsd: this.state.liquidityUsd,
    };
  }

  private transitionRegime(): void {
    this.state.regimeAge++;
    const roll = this.rng();
    const ageBias = Math.min(0.18, this.state.regimeAge / 120);

    if (this.state.regime === "range" && roll < 0.08 + ageBias) {
      this.state.regime = roll < 0.04 + ageBias / 2 ? "trend" : "stress";
      this.state.regimeAge = 0;
      return;
    }

    if (this.state.regime === "trend" && roll < 0.12 + ageBias) {
      this.state.regime = roll < 0.07 + ageBias / 2 ? "range" : "stress";
      this.state.regimeAge = 0;
      return;
    }

    if (this.state.regime === "stress" && roll < 0.2 + ageBias) {
      this.state.regime = roll < 0.11 + ageBias / 2 ? "range" : "trend";
      this.state.regimeAge = 0;
    }
  }
}

function normalizeSeed(seed: number): number {
  const normalized = Math.abs(Math.floor(seed)) % 2_147_483_647;
  return normalized === 0 ? 1 : normalized;
}

function fingerprintSymbols(symbols: string[]): number {
  const text = symbols.length > 0 ? symbols.join("|") : "BTCUSDT";
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
