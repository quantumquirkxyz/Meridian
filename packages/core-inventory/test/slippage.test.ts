import { describe, expect, test } from "bun:test";
import { computeSlippageBps, estimateSlippageBps } from "@agenttrading/core-inventory";

describe("computeSlippageBps", () => {
  test("returns base slippage when liquidity is zero", () => {
    expect(computeSlippageBps(100, 0, 10)).toBe(10);
  });

  test("adds linear depth impact to base slippage", () => {
    // 100 / 1000 = 0.1 ratio -> 100 bps impact
    expect(computeSlippageBps(100, 1000, 10)).toBe(110);
  });

  test("returns base when order size is zero", () => {
    expect(computeSlippageBps(0, 1000, 10)).toBe(10);
  });
});

describe("estimateSlippageBps", () => {
  describe("CEX with depth data", () => {
    test("combines spread and depth impact", () => {
      // spreadBps = 10, orderSize = 100, depth = 10000
      // impactRatio = 0.01, depthImpact = 0.01 * 10000 = 100
      // total = 10 + 100 = 110
      expect(estimateSlippageBps(100, 10000, 10, "CEX")).toBe(110);
    });

    test("returns spread when depth is zero", () => {
      expect(estimateSlippageBps(100, 0, 10, "CEX")).toBe(10);
    });

    test("returns spread when order size is zero", () => {
      expect(estimateSlippageBps(0, 10000, 10, "CEX")).toBe(10);
    });

    test("handles large order relative to depth", () => {
      // orderSize = 5000, depth = 10000, impactRatio = 0.5
      // depthImpact = 0.5 * 10000 = 5000
      // total = 10 + 5000 = 5010
      expect(estimateSlippageBps(5000, 10000, 10, "CEX")).toBe(5010);
    });
  });

  describe("DEX with depth data", () => {
    test("applies constant-product approximation", () => {
      // orderSize = 100, depth = 10000
      // impactRatio = 0.01, slippageBps = 0.01 * 100 = 1
      expect(estimateSlippageBps(100, 10000, 0, "DEX")).toBe(1);
    });

    test("returns spread when depth is zero", () => {
      expect(estimateSlippageBps(100, 0, 0, "DEX")).toBe(0);
    });

    test("returns spread when order size is zero", () => {
      expect(estimateSlippageBps(0, 10000, 0, "DEX")).toBe(0);
    });

    test("handles order equal to depth", () => {
      // orderSize = depth = 10000, impactRatio = 1
      // slippageBps = 1 * 100 = 100
      expect(estimateSlippageBps(10000, 10000, 0, "DEX")).toBe(100);
    });
  });

  describe("fallback behavior", () => {
    test("falls back to spreadBps when depth is missing", () => {
      expect(estimateSlippageBps(100, 0, 25, "CEX")).toBe(25);
      expect(estimateSlippageBps(100, 0, 25, "DEX")).toBe(25);
    });

    test("falls back to spreadBps when order size is missing", () => {
      expect(estimateSlippageBps(0, 10000, 25, "CEX")).toBe(25);
      expect(estimateSlippageBps(0, 10000, 25, "DEX")).toBe(25);
    });
  });
});
