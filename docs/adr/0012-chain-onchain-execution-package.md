# ADR-0012: On-chain execution lives in a dedicated `chain` package

**Date:** 2026-09-02
**Status:** Accepted
**Deciders:** Jhuomar Boskoll Quintero

## Context

The system must execute on DEX venues (PancakeSwap v4 on BNB Chain) in addition to the Bybit CEX. On-chain execution requires an Ethereum/web3 library (`viem`) to read pool reserves, sign transactions with a private key, and submit `swapExactTokensForTokens` calls through the PancakeSwap router.

`packages/connectors` enforces a strict architectural boundary (ARCHITECTURE.md): it depends **only** on `@agenttrading/contracts`. This invariant is enforced by `test/boundaries.test.ts`. Adding `viem` as a hard dependency of `connectors` would violate that invariant and its enforcement test.

Two distinct concerns were entangled:
1. **DEX market data** (reading pool reserves to normalize `MarketDataSnapshot`) — needs only an RPC `eth_call`, which can be done with plain `fetch` and no web3 dependency.
2. **DEX execution** (signing and broadcasting swaps with a private key) — fundamentally requires a web3 library.

## Decision

- Create a new workspace package, `packages/chain` (`@agenttrading/chain`), that depends only on `@agenttrading/contracts` and `viem`. It owns the on-chain execution seam: `DEXExecutor` (reserve reads, swap simulation, gas/nonce, signed swap execution, transaction confirmation) and factories (`createBSCExecutor`).
- Keep `packages/connectors` dependency-light: it owns only DEX **market data** normalization. Its `PancakeSwapMarketDataConnector` reads reserves via a minimal JSON-RPC `fetch` (hardcoded `getReserves` selector `0x0902f1ac`), with no `viem` dependency, preserving the "depends only on contracts" boundary.
- `packages/cli` (the wiring layer) depends on both `@agenttrading/connectors` and `@agenttrading/chain`. `LiveRunner` routes order placement by `intent.venue`: `pancakeswap-v4` → `chain` `DEXExecutor`; otherwise → Bybit REST.

## Consequences

- `connectors` keeps its low-dependency, purely-normalization role; the enforcement test continues to pass.
- The `chain` package is where all heavy signing/web3 logic lives, isolated and independently verifiable.
- Boundary test and ARCHITECTURE.md updated: `chain` depends only on `contracts` and `viem`; `cli` depends on `contracts`, `core`, `connectors`, `chain`, `infra`, and `agents`.
- DEX execution is a scaffold in `LiveRunner`: the swap path/amount mapping uses the configured pool spec and router; production-grade quoting and token-address mapping remain config-driven.
