# Operating Guide — Meridian Trading System

## Prerequisites
- Bun runtime installed
- Bybit account (for demo and/or live)
- OpenRouter API key (optional, for agent reasoning; system runs deterministically without it)

## Step 1: Demo Validation (REQUIRED before live)
After running the demo, validate with:
```bash
bun run validate:demo
```
Then review the session report in `./reports/<session-id>/` against the criteria below.

### Automated Validation
`scripts/validate-demo.ts` runs the automated checks against the session report generated in `./reports/<session-id>/`. It validates trade counts, win rate, net PnL, reconciliation status, audit log completeness, kill switch activations, slippage, and WebSocket stability. Run it after stopping the demo runner to get a pass/fail verdict before manual review.

### Demo Connectivity Verification
`scripts/verify-demo-connectivity.ts` performs 5 pre-flight checks against the configured Bybit mode (demo or live): `.env` existence, credential loading, public market data connectivity, API key validity, and account reachability. A timestamp sync check detects clock drift > 3s before authenticated calls. Run it after configuring `.env` to catch connectivity issues before launching a session.

1. Get Bybit Demo Trading keys from https://www.bybit.com/app/user/api-management
   - Important: Demo keys are separate from live keys
2. Copy `.env.example` to `.env`
3. Set `MODE=demo`
4. Fill `BYBIT_API_KEY` and `BYBIT_API_SECRET` with demo keys
5. Run: `bun run start --mode demo --config canary-demo.json`
6. Validate:
   - [ ] System connects to Bybit Demo Trading (public + private WS)
   - [ ] Market data ingests normally
   - [ ] Opportunity detector runs without errors
   - [ ] Risk Engine evaluates candidates
   - [ ] Orders place and fill (or reject) correctly
   - [ ] Reconciliation runs and passes
   - [ ] Audit log writes to `./reports/<session-id>/audit.jsonl`
   - [ ] Session summary prints on exit
7. Press Ctrl+C to stop
8. Review the session report in `./reports/`

## Demo Validation Criteria
All of the following must pass before proceeding to live:

- Minimum 10 trades executed
- Win rate > 40%
- Net PnL positive after all costs
- Reconciliation passes 100% of the time
- Audit log completeness: every order has corresponding audit events
- No kill switch activations due to bugs (only legitimate market conditions)
- Slippage within 2x of estimated values
- All WebSocket connections stable for session duration

## Step 2: Live Preparation (only after demo passes)
1. Get real Bybit API keys
   - CRITICAL: Withdrawals MUST be disabled on the trading key
   - Create separate read and trading keys
2. Create `canary-live.json` (or use the provided template) with strict limits:
   - maxCapitalUsd: $500
   - maxRiskPerTradeUsd: $25
   - maxDailyLossUsd: $80
   - autoHaltDailyLossUsd: $50
3. Fill `.env`:
   - `MODE=live`
   - Real `BYBIT_API_KEY` and `BYBIT_API_SECRET`
   - `PANCAKESWAP_RPC_URL` (optional, for DEX)
   - `PANCAKESWAP_PRIVATE_KEY` (optional, for DEX execution)
   - `PANCAKESWAP_ROUTER_ADDRESS` (optional, for DEX execution)
4. Dry-run first: `bun run start --mode live --config canary-live.json --dry-run`
5. Verify:
   - [ ] Connectivity check passes
   - [ ] API keys validated
   - [ ] Withdrawals disabled confirmed
   - [ ] No orders actually placed in dry-run
6. Run connectivity verification: `bun run scripts/verify-demo-connectivity.ts`
7. Run live readiness validation: `bun run validate:live`
   - Validates typecheck, test suite, cost models, demo evidence, and live config
   - Generates `live-session-report-template.json` for the first live session

## Live Readiness Checklist

All of the following must be confirmed before starting the live canary:

- [ ] Demo validation passed (10/10 checks)
- [ ] Demo session report shows `readyForLive: true`
- [ ] `canary-live.json` exists and is valid
- [ ] `withdrawalsDisabled: true` in canary-live.json
- [ ] Real Bybit API keys with withdrawals disabled (NOT demo keys)
- [ ] Dry-run completed successfully with no orders placed
- [ ] Operator understands rollback procedure
- [ ] Capital available is within canary limits ($500 max)
- [ ] Emergency stop procedure understood

### Connectivity Verification
`scripts/verify-demo-connectivity.ts` performs 5 pre-flight checks against the configured Bybit mode (demo or live): `.env` existence, credential loading, public market data connectivity, API key validity, and account reachability. A timestamp sync check detects clock drift > 3s before authenticated calls. Run it after configuring `.env` to catch connectivity issues before launching a session.

## Step 3: Live Canary
1. Start live canary: `bun run start --mode live --config canary-live.json`
2. Monitor:
   - Session report in `./reports/`
   - Kill switch triggers
   - Reconciliation status
   - Audit trail completeness
3. Emergency stop: Ctrl+C or TUI command `halt`

### Daily Monitoring Checklist
- [ ] PnL reviewed and within daily loss limit
- [ ] Kill switch status: no unexpected activations
- [ ] Reconciliation passed for all orders
- [ ] Audit trail is complete with no gaps

### Weekly Review Checklist
- [ ] Performance metrics analyzed (win rate, Sharpe, drawdown)
- [ ] Cost model accuracy validated against actual fees
- [ ] Edge decay assessed: strategy still generating alpha

### Monthly Escalation Criteria
- **Increase capital**: Consistent profitability for 30 days, win rate > 50%, daily loss limit never triggered
- **Stop canary**: Any exit criterion triggered, regulatory changes, or strategy decay beyond recovery

## Live Canary Exit Criteria

Stop the canary immediately if any of the following occur:

- Daily loss exceeds $50 (auto-kill)
- Weekly loss exceeds $150 (auto-kill)
- 3+ consecutive days of negative PnL
- Reconciliation fails 2+ times in a day
- Audit trail has gaps
- Slippage consistently exceeds 2x estimates
- Win rate drops below 30%
- Any bug-induced kill switch activation

## Live Session Report

- Where to find it: `./reports/<session-id>/` after a live session exits
- How to use `scripts/generate-live-report.ts`: Run after session completion to produce a structured report with PnL, trade counts, reconciliation status, audit completeness, kill switch events, and recommendation (`continueCanary` / `escalateCapital` / `rollbackToDemo`)
- What to look for in the report: PnL trajectory, win rate, slippage vs estimate, reconciliation pass rate, audit log gaps, kill switch events
- How to interpret the recommendation:
  - `continueCanary`: Metrics healthy, continue current capital level
  - `escalateCapital`: Strategy proving robust, consider increasing capital after review
  - `rollbackToDemo`: Issues detected, return to demo for remediation

## Demo Session Report
- Where to find it: `./reports/<session-id>/` after a demo or live session exits
- How to fill the demo report template: Record session start/end timestamps, mode, config file used, trade count, win rate, net PnL, reconciliation result, audit log path, kill switch events, WebSocket connection uptime, and any anomalies observed
- What to look for in the audit log: Every order event (created, updated, filled, canceled) should have a matching entry in `audit.jsonl`. Missing or out-of-order entries indicate completeness gaps that must be resolved before live

## Mode Contract
| Mode | Purpose | Capital |
|---|---|---|
| demo | Validate integration with virtual assets | $0 risk |
| live | Bounded capital canary | Strict limits in canary-live.json |

## Invariants (Never Broken)
- No AI agent executes, approves risk, signs transactions, or moves funds
- Every order must pass Risk Engine approval
- Reconciliation must pass before new orders
- Audit must be available to trade
- Demo and live are separate; demo evidence is required before live

## Troubleshooting
- **"Demo orders not filling"**: Check Bybit Demo Trading endpoint, ensure demo keys are used not live keys
- **"Insufficient demo balance"**: Demo accounts start with virtual USDT; check balance via REST
- **"WebSocket auth failed in demo"**: Demo WS uses `wss://stream-demo.bybit.com/v5/private`, not the live URL
- **"Bybit API connectivity check failed"**: Check network, API keys, and endpoint URLs
- **"Reconciliation unresolved"**: Review orphan orders, ensure exchange state matches internal state
- **"Kill switch activated"**: Check daily/weekly loss limits; resolve cause before restarting
- **"Audit unavailable"**: Ensure disk space and write permissions for `./reports/`
- **"Live orders rejected"**: Check risk limits, exposure, slippage tolerance
- **"Kill switch activated"**: Review daily/weekly loss, resolve before restarting
- **"Reconciliation mismatch"**: Check for orphan orders, verify exchange state
- **"Withdrawal error"**: Ensure withdrawals are disabled on API keys
- **"Insufficient balance"**: Verify capital is within canary limits
- **"validate-live timeout"**: Script now enforces 60s timeouts on all subprocess checks. If timeout persists, run `bun test` and `bun run typecheck` manually to isolate the slow step.
- **"Bybit timestamp drift (error 10002)"**: Client clock is ahead of Bybit server. The connectivity verifier now uses `recvWindow=10000` and performs a pre-flight timestamp sync. If drift exceeds 3s, synchronize your system clock via NTP.

## Rollback
- Stop the runner: Ctrl+C
- Cancel all open orders: `session.control("cancel-all")` via TUI
- Review logs in `./reports/<session-id>/`
- To downgrade from live to demo: switch `.env` MODE to `demo`, verify connectivity with `bun run scripts/verify-demo-connectivity.ts`, and restart
