# Operating Flow: Demo -> Live

This repo advances by eliminated operational risk, not by feature count. The
trading flow is a two-phase gate: demo validation first, live capital last.

## First Principles

Trading infrastructure behaves like a controlled system with coupled feedback
loops. A profitable signal is only useful if the system can observe state,
decide under constraints, execute deterministically, reconcile external state,
and audit the result. Each phase removes a different class of uncertainty:

1. `demo` removes exchange-integration risk against Bybit Demo Trading.
2. `live` controls capital risk with canary limits and explicit approval.

The phases must not be collapsed. Demo exchange behavior does not prove safe
live-capital operation.

## Phase Contract

| Phase | Purpose | Credentials | Execution Surface | Exit Gate |
|---|---|---|---|---|
| `demo` | Validate Bybit REST/WebSocket integration with virtual assets. | Bybit Demo Trading keys only. | Demo REST endpoint, demo private WebSocket, normal public market stream, and virtual balances. | Order lifecycle, private stream confirmation, reconciliation, limits, and audit pass under realistic exchange behavior. |
| `live` | Run bounded capital canary after demo evidence exists. | Real Bybit keys with withdrawals disabled. | Live Bybit endpoints with real balances. | Explicit human approval, canary config, kill switch, audit, and rollback path. |

## Invariants

- No AI agent executes, approves risk, signs transactions, moves funds, or modifies risk limits.
- No OrderIntent exists without deterministic Risk Engine approval.
- No phase may skip reconciliation or audit.
- `demo` must not use live credentials or the live runner.
- `live` must not start without explicit approval, real credentials, disabled withdrawals, canary limits, and a rollback path.
- Any unresolved data, risk, execution, reconciliation, or audit failure reduces permissions and fails closed.

## Implementation Order

1. Add a dedicated Bybit Demo Trading runner with runtime/config demo-key injection, demo endpoint selection, order lifecycle tests, reconciliation, and audit.
2. Promote to `live` only after demo produces evidence that the loop is stable under realistic conditions.

## Bybit Demo Trading Surface

Bybit Demo Trading is isolated from live mainnet. Its REST base URL is
`https://api-demo.bybit.com`. Its demo WebSocket domain is
`wss://stream-demo.bybit.com`, and Bybit documents that domain for private demo
streams; public market data remains the normal Bybit public WebSocket stream.
The WebSocket trade channel is not supported for demo trading, so demo order
validation must use REST order actions plus private stream confirmation.

Source: https://bybit-exchange.github.io/docs/v5/demo

## Tracker Hygiene

Do not create implementation issues until the phase contract is stable and each
ticket is independently buildable. When tickets are created, keep them as tracer
bullets tied to this contract: one observable behavior, one owner, one
validation command, and one clear rollback.
