# 0001 — TypeScript + Bun in a monorepo

We adopt **TypeScript + Bun** in a **monorepo with bun workspaces** (`packages/contracts`, `packages/core`, `packages/connectors`, `packages/graph`, `packages/harness`, `packages/agents`, `packages/infra`) with `contracts` as the shared typed frontier. The contracts between agents and engines (OrderIntent, RiskDecision, AuditEvent, etc.) are TypeScript; Bun provides a fast runtime and native WebSocket (key for Bybit feeds); and architectural boundaries become compile-time errors.

Status: accepted
Considered options: Node; a TypeScript + Python hybrid for quantitative analysis; a flat `/src` in a single package. Rejected for cross-runtime contract friction and lack of layer isolation.
