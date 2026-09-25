# Operating Guide — Meridian Trading System

## Prerequisites
- Bun runtime installed
- Bybit account (for demo and/or live)
- OpenRouter API key (optional, for agent reasoning; system runs deterministically without it)

## Step 1: Demo Validation (REQUIRED before live)
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

## Step 3: Live Canary
1. Start live canary: `bun run start --mode live --config canary-live.json`
2. Monitor:
   - Session report in `./reports/`
   - Kill switch triggers
   - Reconciliation status
   - Audit trail completeness
3. Emergency stop: Ctrl+C or TUI command `halt`

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
- **"Bybit API connectivity check failed"**: Check network, API keys, and endpoint URLs
- **"Reconciliation unresolved"**: Review orphan orders, ensure exchange state matches internal state
- **"Kill switch activated"**: Check daily/weekly loss limits; resolve cause before restarting
- **"Audit unavailable"**: Ensure disk space and write permissions for `./reports/`

## Rollback
- Stop the runner: Ctrl+C
- Cancel all open orders: `session.control("cancel-all")` via TUI
- Review logs in `./reports/<session-id>/`
- Downgrade from live to demo by switching `.env` MODE and restarting
