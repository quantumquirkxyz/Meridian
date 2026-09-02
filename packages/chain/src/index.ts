/**
 * On-chain execution for DEX venues (PancakeSwap on BNB Chain) using viem.
 * Depends only on @agenttrading/contracts and viem. Lives in its own package
 * so the `connectors` boundary (depends only on contracts) stays intact.
 */
export * from "./dex-executor.ts";
