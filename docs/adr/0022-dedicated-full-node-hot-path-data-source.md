# 0022 — Dedicated full node as the Execution Loop's primary DEX data source

Status: proposed
Date: 2026-09-20

## Context

ADR-0021 designates the Execution Loop as the hot path for DEX execution and requires a single premium data source. Three options were considered: a dedicated full node, a premium single WebSocket, or a private RPC endpoint with MEV protection.

The chosen option is a dedicated full node. This means the system operates its own BNB Chain full node (or equivalent for the target chain) as the authoritative source for pool reserves, gas prices, and pending transaction state in the Execution Loop.

## Decision

The Execution Loop reads DEX market data exclusively from a dedicated full node operated by the system. No third-party RPC provider is consulted in the hot path.

A premium WebSocket from a single provider is an acceptable fallback only if operating a full node is operationally infeasible; in that case, the WebSocket provider must be explicitly pinned (TLS certificate fingerprint per ADR-S04) and the single-provider risk must be accepted as a known operational trade-off.

The dedicated full node is not used for execution transaction submission; execution still routes through MEV-protected RPCs (ADR-0016, ADR-0021). Its role is limited to market data reads for the Execution Loop.

## Consequences

- Positive: The Execution Loop has full control over data freshness and can read pending state, gas estimates, and reserve changes without third-party latency.
- Positive: No multi-RPC consensus overhead in the hot path; the node is the single source of truth.
- Negative: Operating a full node requires infrastructure (VM, storage, bandwidth, sync monitoring). A synced node can be 500GB+ and requires ongoing maintenance.
- Negative: If the full node falls behind or becomes unavailable, the Execution Loop has no fallback in the hot path. The system must transition to `OBSERVE_ONLY` until the node is restored.
- Follow-up: Define the node health monitoring contract (block lag, peer count, sync status) and the automatic mode transition when the node is degraded.
