import { describe, expect, test } from "bun:test";
import { createSeededRng } from "../src/seed.ts";

describe("SeededRng (xorshift32)", () => {
  test("same seed produces identical sequences (bit-exact reproducibility)", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    for (let i = 0; i < 1000; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  test("different seeds produce different sequences", () => {
    const rng1 = createSeededRng(1);
    const rng2 = createSeededRng(2);

    let differentCount = 0;
    for (let i = 0; i < 100; i++) {
      if (rng1.next() !== rng2.next()) differentCount++;
    }
    expect(differentCount).toBeGreaterThan(0);
  });

  test("next() returns values in [0, 1)", () => {
    const rng = createSeededRng(12345);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("nextInt returns integer in [min, max] inclusive", () => {
    const rng = createSeededRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  test("clone produces independent copy with same state", () => {
    const rng = createSeededRng(42);
    rng.next(); // advance state
    rng.next();

    const clone = rng.clone();
    // Clone should produce same sequence from this point.
    for (let i = 0; i < 100; i++) {
      expect(rng.next()).toBe(clone.next());
    }
  });

  test("getState returns current state", () => {
    const rng = createSeededRng(42);
    const state1 = rng.getState();
    rng.next();
    const state2 = rng.getState();
    expect(state1).not.toBe(state2);
  });

  test("seed of 0 is treated as 1 (xorshift32 forbids zero)", () => {
    const rng1 = createSeededRng(0);
    const rng2 = createSeededRng(1);
    // Both should produce the same sequence.
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  test("next distribution is approximately uniform", () => {
    const rng = createSeededRng(42);
    const buckets = new Array(10).fill(0);
    const samples = 100_000;

    for (let i = 0; i < samples; i++) {
      const v = rng.next();
      const bucket = Math.floor(v * 10);
      buckets[Math.min(bucket, 9)]++;
    }

    // Each bucket should be roughly 10% ± 2%.
    for (const count of buckets) {
      const ratio = count / samples;
      expect(ratio).toBeGreaterThan(0.08);
      expect(ratio).toBeLessThan(0.12);
    }
  });
});
