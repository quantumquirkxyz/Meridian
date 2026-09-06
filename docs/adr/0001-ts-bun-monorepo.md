# 0001 — TypeScript + Bun in a monorepo

Status: accepted
Date: 2026-08-13
Deciders: Jhuomar Boskoll Quintero

## Context

The system requires a runtime that supports:
- Fast startup and hot reload for iterative development
- Native WebSocket support (critical for Bybit real-time feeds)
- Strong typing for cross-package contracts (OrderIntent, RiskDecision, etc.)
- SQLite access without external dependencies
- Single language across all packages to avoid cross-runtime friction
- Monorepo tooling for workspace management

The project operates in a domain where latency matters (market data, order execution) and where type safety prevents costly runtime errors (mislabeled orders, wrong risk calculations).

## Decision

We adopt **TypeScript + Bun** in a **monorepo with Bun workspaces** (`packages/contracts`, `packages/core`, `packages/events`, `packages/connectors`, `packages/chain`, `packages/graph`, `packages/harness`, `packages/agents`, `packages/infra`, `packages/cli`) with `contracts` as the shared typed frontier.

## Update 2026-09-06

The workspace grew to 10 packages as the execution and delivery layers landed: `events` (event bus + SQLite store, ADR-0006), `chain` (on-chain execution seam, ADR-0012), `agents` (per-scope general agents + consultative catalog, ADR-0004/0013), and `cli` (LiveRunner wiring, ADR-0011).

## Options considered

1. **Node.js + TypeScript** — Rejected. WebSocket requires external library (`ws`). SQLite requires `better-sqlite3` with native bindings. Slower startup. No built-in test runner.

2. **TypeScript + Python hybrid** — Rejected. Cross-runtime contract friction: TypeScript types don't validate in Python, Python types don't validate in TypeScript. Two dependency trees, two test runners, two deployment targets. The quantitative analysis advantage doesn't justify the integration cost for a trading system where type safety is critical.

3. **Flat `/src` in a single package** — Rejected. No compile-time boundary enforcement. Agents could import connectors, core could import LLMs. Architectural rules become runtime checks instead of compile errors.

4. **Go or Rust** — Rejected. Higher development velocity needed for iterative prototyping. TypeScript + Bun provides sufficient performance for the current scale; native optimization can be added later for latency-critical paths.

## Consequences

- **Positive:** Architectural boundaries become compile-time errors. `tsc --noEmit` catches boundary violations before runtime.
- **Positive:** Single test runner (`bun test`), single build tool, single dependency manager.
- **Positive:** Native WebSocket and SQLite (bun:sqlite) without native bindings.
- **Positive:** Fast iteration cycle — `bun run start` starts in seconds.
- **Negative:** Bun is younger than Node.js; some ecosystem packages may have compatibility issues.
- **Negative:** No built-in cluster mode; multi-process orchestration requires external tooling.
- **Follow-up:** Monitor Bun stability for production workloads. If performance becomes critical for latency paths, consider Go/Rust microservices for those specific components.
