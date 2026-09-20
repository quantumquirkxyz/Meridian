# 0017 — Emergency liquidation before HALT: orphan exposure must be force-closed

Status: proposed
Date: 2026-09-20

## Context

Hybrid CEX/DEX arbitrage requires two-leg execution (e.g., buy on Bybit, sell simultaneously on PancakeSwap). The primary defense against orphan exposure is order-type enforcement: the Risk Engine requires FOK or IOC for the CEX leg of dual-leg arb, so a failed DEX leg cannot leave a residual CEX position. The secondary defense is the `LIQUIDATING` mode described below.

If one leg executes and the other fails — due to DEX congestion, bridge delay, or RPC failure — despite FOK/IOC enforcement, the system detects a reconciliation mismatch and currently transitions directly to `HALT`.

The current **SystemMode** definition treats `HALT` as the terminal defensive state. The **Reconciliation** definition says "on mismatch, blocks new positions and may activate defensive modes." The **Kill Switch** "activates `HALT` mode and blocks all new `OrderIntent` objects."

The problem: `HALT` stops new orders but does nothing to the orphan leg that is already open. In a volatile market, an orphan directional position accumulates unrealized PnL risk. Stopping the orchestrator does not stop the market; it stops the system's ability to manage the risk it just created.

## Decision

Introduce `LIQUIDATING` as a transient `SystemMode` immediately preceding `HALT`. When reconciliation detects a partial fill or bridge failure that leaves an orphan directional exposure:

1. The system transitions to `LIQUIDATING` mode.
2. The **Emergency Liquidation** subsystem force-closes the orphan exposure at market (market orders, not limit orders).
3. Only after the directional exposure reaches zero does the system transition to `HALT`.

The **Kill Switch** also routes through `LIQUIDATING` before `HALT` when orphan positions are detected. The **Risk Engine** `HALT_SYSTEM` dictamen is interpreted by the orchestrator as "enter LIQUIDATING, then HALT" rather than "enter HALT immediately."

## Consequences

- Positive: The system never enters `HALT` with open directional exposure. Risk is reduced, not magnified, by failures.
- Positive: Emergency liquidation is a bounded, time-limited operation. Market-order execution at unfavorable price is accepted as the cost of avoiding uncontrolled directional exposure.
- Negative: Liquidation at market during high volatility may realize a loss larger than the original edge. This is preferable to unlimited directional risk.
- Negative: The `LIQUIDATING` mode must be governed by its own timeout and fallback (e.g., if liquidation fails after N seconds, escalate to manual intervention via TUI).
- Follow-up: Define the maximum liquidation duration and the fallback path if market conditions prevent full liquidation within that window.
