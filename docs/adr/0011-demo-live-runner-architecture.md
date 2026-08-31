# Unified Runner for Demo and Live with Continuous Demo Reconciliation

Status: accepted
Date: 2026-08-31

## Context

`OPERATING_FLOW.md` defines a two-phase gate: `demo` (Bybit Demo Trading, virtual assets, exchange-integrated) then `live` (real capital, bounded canary). The connectors (`BybitRESTClient`, `BybitWebSocketClient`) already expose `DEMO_BASE_URL` and `DEMO_PRIVATE_WS_URL`. The execution layer (Beta.5 `SimulatedExecutionEngine`) currently sits inside `LiveExecutionEngine` and is the only place orders are placed. There is no runner that wires the Bybit connectors to a real exchange with reconciliation and audit under both modes, and no explicit decision about how the runner, regime policy, reconciliation, and kill switch behave across `demo` and `live`.

Without a single explicit decision the project risks two parallel runners (drift), or a permissive demo that hides integration defects that only show up against real capital, or a too-restrictive demo that never exercises the full integration surface.

## Decision

A single `LiveRunner` receives `bybitEndpoints` from `AppConfig` and selects mode at construction:

1. `MODE=demo` → `restUrl=api-demo.bybit.com`, `wsUrl=stream-demo.bybit.com`. Runs against Bybit Demo with virtual balances.
2. `MODE=live` → mainnet Bybit endpoints. Runs with real keys, canary limits, and operator approval.

No parallel `DemoRunner` or `LiveRunner` exists. `AgentAdapter` is identical across modes. The `SimulatedExecutionEngine` is the shared internal engine that the runner wraps; it is no longer the boundary between modes — the runner's wiring to Bybit (demo or mainnet) is.

Additional mode-shape rules locked in by this decision:

- **Continuous reconciliation in `demo`**: every demo order is confirmed via the private WebSocket. Mismatches that exceed a threshold transition the system to `CANCEL_ONLY_MODE`. `AuditReconstructor` must be able to rebuild the full cycle before `live` is authorized. `live` keeps the same protocol; the rule is the same, only the exchange is real.
- **Permissive regime policy in `demo`**: `RegimeClassifier` and `RegimePolicyEngine` operate identically in both modes, but in `demo` the policy may allow more activity (no real capital → maximize integration stress-testing). `live` tightens the same policy.
- **Identical kill switch in both modes**: manual TUI operator halt + automatic drawdown-triggered halt must be validated against Bybit Demo before `live` is authorized.
- **Manual review exit gate `demo` → `live`**: promotion requires a human review with documentary evidence (exported JSON/CSV/TXT reports, audit reconstruction, loop-stability evidence, explicit operator approval). Pure automated metrics are insufficient.

## Consequences

- Positive: one code path for execution → integration defects are caught in `demo` before they reach `live`. The runner cannot drift between modes.
- Positive: the same audit, reconciliation, and kill switch that protect `live` are the ones validated in `demo`.
- Positive: promotion to `live` is gated on documentary evidence, not just "it ran" — explicit human approval matches the Gamma exit criterion in `ROADMAP.md`.
- Negative: `demo` must absorb the cost of running the full reconciler + audit pipeline against Bybit Demo; this is more work than a permissive synthetic-only mode would be.
- Negative: the runner depends on Bybit Demo availability; if `api-demo.bybit.com` is down, `demo` cannot be exercised (it cannot silently fall back to a synthetic-only mode without breaking the contract).
- Negative: the `LiveExecutionEngine` must be refactored to delegate to the Bybit connectors instead of wrapping `SimulatedExecutionEngine` as the order path. The simulator remains as a harness/test utility.
- Follow-up: when `live` is authorized, the same `AppConfig` shape must accept live endpoints and canary limits; the canary limits are not part of this ADR (Gamma.1 territory).
