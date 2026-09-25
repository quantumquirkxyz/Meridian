import { describe, expect, test, vi } from "bun:test";
import { DEXExecutor, DEXRPCError } from "../src/dex-executor.ts";

describe("DEXExecutor gas price oracle", () => {
  const baseConfig = {
    url: "http://localhost:8545",
    chainId: 56,
    chainName: "bsc",
  };

  test("falls back to nativePriceUsd when no oracle is configured", async () => {
    const executor = new DEXExecutor({
      ...baseConfig,
      nativePriceUsd: 123.45,
    });

    const gasPrice = 1_000_000_000n; // 1 gwei
    const estimatedGas = 150_000n;
    const decimals = 18;
    const expectedGasCostUsd =
      Number((gasPrice * estimatedGas) / BigInt(10 ** decimals)) * 123.45;

    const publicClient = (executor as any).publicClient;
    publicClient.getGasPrice = vi.fn().mockResolvedValue(gasPrice);

    const gasInfo = await executor.getGasInfo();
    expect(gasInfo.gasCostUsd).toBeCloseTo(expectedGasCostUsd, 2);
    expect(publicClient.getGasPrice).toHaveBeenCalledTimes(1);
  });

  test("uses chain default when neither oracle nor nativePriceUsd is configured", async () => {
    const executor = new DEXExecutor(baseConfig);

    const gasPrice = 5_000_000_000n; // 5 gwei
    const estimatedGas = 150_000n;
    const decimals = 18;
    const expectedGasCostUsd =
      Number((gasPrice * estimatedGas) / BigInt(10 ** decimals)) * 500;

    const publicClient = (executor as any).publicClient;
    publicClient.getGasPrice = vi.fn().mockResolvedValue(gasPrice);

    const gasInfo = await executor.getGasInfo();
    expect(gasInfo.gasCostUsd).toBeCloseTo(expectedGasCostUsd, 2);
  });

  test("calls the gas price oracle when provided and uses its value", async () => {
    const oracle = vi.fn().mockResolvedValue(987.65);
    const executor = new DEXExecutor({
      ...baseConfig,
      gasPriceOracleUsd: oracle,
    });

    const gasPrice = 2_000_000_000n;
    const estimatedGas = 150_000n;
    const decimals = 18;
    const expectedGasCostUsd =
      Number((gasPrice * estimatedGas) / BigInt(10 ** decimals)) * 987.65;

    const publicClient = (executor as any).publicClient;
    publicClient.getGasPrice = vi.fn().mockResolvedValue(gasPrice);

    const gasInfo = await executor.getGasInfo();
    expect(oracle).toHaveBeenCalledTimes(1);
    expect(oracle).toHaveBeenCalledWith("BNB");
    expect(gasInfo.gasCostUsd).toBeCloseTo(expectedGasCostUsd, 2);
  });

  test("oracle return value overrides nativePriceUsd when both are configured", async () => {
    const oracle = vi.fn().mockResolvedValue(555.55);
    const executor = new DEXExecutor({
      ...baseConfig,
      nativePriceUsd: 100,
      gasPriceOracleUsd: oracle,
    });

    const gasPrice = 1_500_000_000n;
    const estimatedGas = 150_000n;
    const decimals = 18;
    const expectedGasCostUsd =
      Number((gasPrice * estimatedGas) / BigInt(10 ** decimals)) * 555.55;

    const publicClient = (executor as any).publicClient;
    publicClient.getGasPrice = vi.fn().mockResolvedValue(gasPrice);

    const gasInfo = await executor.getGasInfo();
    expect(gasInfo.gasCostUsd).toBeCloseTo(expectedGasCostUsd, 2);
  });

  test("uses ETH fallback for non-BSC chain without oracle", async () => {
    const executor = new DEXExecutor({
      ...baseConfig,
      chainId: 1,
      chainName: "ethereum",
    });

    const gasPrice = 20_000_000_000n;
    const estimatedGas = 150_000n;
    const decimals = 18;
    const expectedGasCostUsd =
      Number((gasPrice * estimatedGas) / BigInt(10 ** decimals)) * 3_000;

    const publicClient = (executor as any).publicClient;
    publicClient.getGasPrice = vi.fn().mockResolvedValue(gasPrice);

    const gasInfo = await executor.getGasInfo();
    expect(gasInfo.gasCostUsd).toBeCloseTo(expectedGasCostUsd, 2);
  });
});
