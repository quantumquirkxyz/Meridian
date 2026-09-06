# Risk — Multi-agent CEX/DEX trading system

## Principles

1. **No AI agent executes orders or approves risk.** Authority is deterministic (ADR-0003).
2. **The system can live without agents, not without risk, reconciliation, and audit.**
3. **Fail closed, never open.** A failure reduces permissions and exposure; it never increases them.
4. **Advance by eliminated risk**, not by features.

## Invariants (never broken)

- No OrderIntent exists without Risk Engine approval.
- No trading in degraded, cash-only, or halt mode.
- No trading while reconciliation is unresolved.
- No trading while audit is unavailable.
- No agent has `APPROVE_RISK`, `SUBMIT_ORDER`, `SIGN_TRANSACTION`, `MOVE_FUNDS`, or `MODIFY_RISK_LIMITS`.
- No strategy change reaches live without going through backtest → demo → canary.
- Demo uses virtual assets but still requires deterministic risk, reconciliation, and audit; it must not share live credentials or silently route through live execution.
- The Learning Loop generates hypotheses; it does not mutate production.

## Minimum Risk Engine rules

1. Maximum risk per trade.
2. Maximum daily loss.
3. Maximum weekly loss.
4. Maximum exposure per token.
5. Maximum exposure per venue.
6. Maximum exposure per chain.
7. Maximum open orders.
8. Maximum slippage.
9. Maximum gas.
10. Maximum latency.
11. Minimum data quality score.
12. Minimum expected net profit (edge).
13. Minimum liquidity depth.
14. Maximum funding cost.
15. Maximum correlation concentration.
16. No trading during degraded state.
17. No trading if reconciliation is unresolved.
18. No trading if audit is unavailable.

## Risk Engine actions

`APPROVE` · `REJECT` · `REDUCE_SIZE` · `EXIT_ONLY` · `CANCEL_ONLY` · `CASH_ONLY` · `HALT_SYSTEM`

Every rejected OrderIntent carries reason codes; every approved one carries size, limits, and expiry.

## Net profit formula

```
expectedNetProfitUsd = grossSpreadUsd
                     - tradingFeesUsd
                     - slippageUsd
                     - gasUsd
                     - bridgeCostUsd
                     - fundingCostUsd
                     - latencyRiskUsd
                     - failureRiskUsd
                     - safetyBufferUsd
```

A route is a candidate only if net profit exceeds costs, slippage, gas, latency, and buffer.

## Emergency modes

`OBSERVE_ONLY` → `SIGNAL_ONLY` → `CANCEL_ONLY` → `REDUCE_ONLY` → `CASH_ONLY` → `HALT`

General rule: on technical failure, reduce activity; never increase exposure.

## Fallbacks

| Failure | Action |
|---|---|
| Stale data / degraded venue | `DEGRADED_MODE`, block entries |
| Non-critical agent | Continue without it |
| Mandatory agent for review | Reject the operation |
| Risk Engine | `HALT` — never execute |
| Execution Engine | Reconcile, `CANCEL_ONLY`, alert |
| Failed reconciliation | `HALT` / `REDUCE_ONLY`, no new positions |
| DEX / RPC | Disable DEX routes, CEX-only if allowed |
| CEX API | Block venue, reconcile on recovery |
| Audit unavailable | Do not trade |

## Structural risks monitored

Market, liquidity, execution, counterparty, smart contract, bridge, API, latency, model/overfitting, custody, operational, and technological. On DEX additionally: MEV, contract vulnerabilities, liquidity concentration, oracle errors, congestion, and RPC dependence. See ADR-0005 (no KYC; regulatory knowledge only as risk reference).
