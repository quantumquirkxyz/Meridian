# 0021 — Execution security tiering: hot path and cold path have distinct security contracts

Status: proposed
Date: 2026-09-20

## Context

The existing security hardening decisions (ADR-S01 through ADR-S06) were designed as uniform policies applied across the entire system. In a dual-frequency architecture, this uniformity destroys hot-path viability:

- **ADR-S02 (AWS KMS Signer):** Sending a signing payload to the KMS API adds 50–150ms of network latency per execution attempt. For an Execution Loop that must evaluate and act in sub-millisecond time, this latency alone exceeds the entire opportunity window.
- **ADR-S03 (Multi-RPC Consensus 2/3):** Waiting for three independent RPC providers (QuickNode, Alchemy, Ankr) to respond before accepting a pool reserve read forces the hot path to the speed of the slowest provider. MEV opportunities do not wait for consensus.

The system needs the same security properties (authenticated signing, verified data) with different latency budgets depending on which loop is operating.

## Decision

Security measures are selected by **loop type**, not applied uniformly:

| Property | Execution Loop (hot path) | Cognitive Loop + Reconciliation (cold path) |
|---|---|---|
| Signing | In-memory key injected via 1Password CLI pipe at process start; local `viem` signing; sub-ms | AWS KMS API signing; 50–150ms per operation acceptable |
| Data source | Dedicated full node or premium single WebSocket; no fallback in hot path | Multi-RPC consensus (2/3) for market data; divergent reads trigger pool unavailability |
| RPC topology for execution | Private RPC / OFA / Flashbots for DEX; never public mempool | Public RPC acceptable for analysis and reconciliation reads |

ADR-S02 (AWS KMS) and ADR-S03 (Multi-RPC Consensus) govern the cold path only. The hot path has its own security contract defined here.

## Consequences

- Positive: The Execution Loop meets sub-millisecond latency requirements. Signing and data reads are local and fast.
- Positive: The Cognitive Loop and Reconciliation retain institutional-grade verification (KMS, multi-RPC) where latency is not critical.
- Negative: The hot path's in-memory key is a narrower trust boundary than KMS. Key rotation must be handled by process restart, not by KMS auto-rotation.
- Negative: A single premium WebSocket or dedicated full node is a SPOF for hot-path data. The system must accept this or implement its own fast-fail logic.
- Follow-up: Define the key rotation procedure for the hot-path in-memory key; define the premium WebSocket / full node failover behavior.
