/**
 * Seeded xorshift32 PRNG for bit-exact reproducibility (issue #21 AC1).
 *
 * A recorded backtest session with a fixed seed replays to identical fills,
 * slippage, gas estimates, and failure injection — deterministically.
 */

export interface SeededRng {
  /** Returns a uniform float in [0, 1). */
  next(): number;
  /** Returns an integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number;
  /** Returns the current internal state (for serialization / reproducibility checks). */
  getState(): number;
  /** Clones the RNG with its current state. */
  clone(): SeededRng;
}

/**
 * Create a seeded xorshift32 PRNG.
 * @param seed - Non-zero 32-bit integer seed.
 */
export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  if (state === 0) state = 1; // xorshift32 forbids zero state

  function next(): number {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000; // [0, 1)
  }

  return {
    next,
    nextInt(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    getState(): number {
      return state >>> 0;
    },
    clone(): SeededRng {
      const child = createSeededRng(state);
      return child;
    },
  };
}
