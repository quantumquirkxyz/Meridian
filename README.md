# Meridian — Multi-Agent CEX/DEX Arbitrage Infrastructure

[![Build](https://github.com/quantumquirkxyz/Meridian/actions/workflows/ci.yml/badge.svg)](https://github.com/quantumquirkxyz/Meridian/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-84%20files-green.svg)](#testing--validation)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](#license)

> **Deterministic execution infrastructure for fragmented crypto liquidity.**
> Agents observe and advise; the Risk Engine decides; the Execution Engine acts.
> Fail-closed by design. Audit-first. Demo → Live progression.

## What It Does

Meridian is arbitrage infrastructure for fragmented crypto liquidity across Bybit (CEX) and PancakeSwap v4 (DEX). The system builds a versioned market graph, discovers routes with full cost modeling, and only executes when a deterministic Risk Engine approves. Net profit is computed as gross spread minus trading fees, slippage, gas, bridge cost, funding, latency risk, failure risk, and a safety buffer — a route becomes a candidate only when expected net profit exceeds all costs. This is not a signal service: it is a closed-loop execution system with auditable, reproducible decisions.

## Architecture at a Glance

```
Market Data Connectors (Bybit REST/WS, Binance REST, PancakeSwap RPC)
    ↓
DataQualityMonitor → per-source health tracking
    ↓
Normalizer → MarketDataSnapshot
    ↓
Market Graph Engine → versioned MarketGraph with weighted edges
    ↓
OpportunityDetector → OpportunityCandidate with full cost stack
    ↓
StateGraph Orchestrator
    ↓
AI Advisory Layer → only observes/classifies/debates/explains
    ↓  (general agents: one per trading scope — venue×pool×pair on DEX, venue×pair on CEX)
    ↓  (sub-agents: the 11-agent consultative catalog, scoped to their general agent)
    ↓  (when LLM configured: OpenRouter via Vercel AI SDK)
    ↓  (without LLM: deterministic behavioral adapters)
    Risk Engine → authority: approve/reject/reduce
    ↓
Execution Engine → the only component that sends approved orders
    ↓
Reconciliation Engine → internal vs exchange state
    ↓
Audit / Event Store → JSONL + SQLite
    ↓
Learning Loop → generates hypotheses, does not mutate production
```

Mandatory flow per signal: **data → graph → candidate → agent review → Risk Engine → OrderIntent → Execution Engine → Reconciliation → Audit → Learning**. No step may skip the Risk Engine.

### Core Invariants
- No AI agent executes, approves risk, signs transactions, or moves funds.
- Every order must pass Risk Engine approval before reaching the Execution Engine.
- Reconciliation must pass before new orders are placed.
- Audit must be available to trade.
- Demo and live are separate; demo evidence is required before live.

## Quickstart

```bash
# 1. Clone & install
git clone https://github.com/quantumquirkxyz/Meridian.git
cd Meridian && bun install

# 2. Configure (demo mode — zero risk)
cp .env.example .env
# Edit .env: set MODE=demo and add Bybit Demo Trading keys

# 3. Run demo canary
bun run start --mode demo --config canary-demo.json

# 4. Validate: orders place → fills confirm → reconciliation passes → audit complete
# 5. For live: see docs/OPERATING_GUIDE.md
```

## Project Structure

| Package | Responsibility |
|---------|----------------|
| `contracts` | Types, schemas, events, cost model (shared frontier) |
| `core` | StateGraph, Risk Engine, Execution, Reconciliation, Inventory, Loops |
| `events` | Event bus, SQLite store, deterministic replay |
| `connectors` | Bybit REST/WS, Binance REST, PancakeSwap RPC |
| `chain` | On-chain execution (DEXExecutor via viem) |
| `graph` | MarketGraph, pathfinder, arbitrage cycles, systemic risk |
| `harness` | Backtest, simulators, stress tests |
| `agents` | General agents (per scope) + 11 consultative sub-agents |
| `infra` | DataQualityMonitor, Observability, CanaryControlTUI (Ink) |
| `cli` | LiveRunner, config, manifest, status display |

## Agent Layer

Deployment is per **trading scope**: one **general agent** per (venue, pool, pair) on a DEX and per (venue, pair) on a CEX. Each general agent is the cognitive coordinator of its scope — it decides which sub-agents to run, feeds them scoped inputs, aggregates their structured outputs, and emits a single recommendation per cycle for the Risk Engine.

The complete catalog of **11 consultative agents** is the **sub-agent** library; every general agent binds these roles to its scope.

| Layer | Agents |
|-------|--------|
| Analytical | Arbitrage-Alpha, Market Regime |
| Deliberative | Planner/Supervisor, Bull, Bear, Skeptic, Execution Advisor |
| Control / Audit | Risk Analyst, Memory, Audit, Policy |

Agents never execute, approve risk, or move funds. The Risk Engine remains the sole execution authority for every scope.

## Risk & Safety

- **18 minimum risk rules** covering per-trade/day/week limits, exposure per token/venue/chain, slippage, gas, latency, data quality, minimum edge, liquidity, funding, correlation, and mode gating.
- **7 defensive modes**: `OBSERVE_ONLY` → `SIGNAL_ONLY` → `CANCEL_ONLY` → `REDUCE_ONLY` → `CASH_ONLY` → `HALT`, plus `DEGRADED_MODE`.
- **Kill switch**: automatic halt on daily loss, weekly loss, order count, orphans, or reconciliation mismatch; manual halt via TUI.
- **Canary limits**: strict capital, exposure, and order caps in `canary-demo.json` and `canary-live.json`; no automatic scaling.
- **Fail-closed philosophy**: any technical failure reduces permissions and exposure; it never increases them.

## Testing & Validation

```bash
bun test                # 84+ test files
bun run typecheck       # Strict TypeScript
bun run verify          # typecheck + tests
bun run validate:costs  # Cost model vs simulator validation
```

## Documentation

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System flow, StateGraph, agents, permissions, stack |
| [ROADMAP.md](docs/ROADMAP.md) | Risk-elimination progression and exit criteria |
| [OPERATING_GUIDE.md](docs/OPERATING_GUIDE.md) | Demo → Live step-by-step, invariants, troubleshooting |
| [RISK.md](docs/RISK.md) | Risk principles, invariants, net profit formula, fallbacks |
| [ANALYSIS.md](docs/ANALYSIS.md) | Deep analysis of algorithms, math, microstructure, money-leak vectors |
| [OPERATING_FLOW.md](docs/OPERATING_FLOW.md) | Mode contract, demo vs live, implementation order |

## Configuration

- `.env` — Mode, API keys, LLM, cycle interval (see `.env.example`)
- `canary-demo.json` — Demo canary limits ($100 max capital, $5 max risk per trade, 10 orders/day)
- `canary-live.json` — Live canary limits ($500 max capital, $25 max risk per trade, 15 orders/day, withdrawals disabled)

## Development

```bash
bun test              # Run tests
bun run typecheck     # TypeScript check
bun run verify        # typecheck + test
bun run validate:costs # Cost model validation
```

## License

MIT — see [LICENSE](LICENSE)

---

**Disclaimer:** This is trading infrastructure, not financial advice. Live trading carries risk. Always validate in demo first. Never risk funds you cannot afford to lose.
