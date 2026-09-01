# Promotion Checklist: demo → live

Per `OPERATING_FLOW.md`, promotion from `demo` (Bybit Demo Trading) to `live`
(real capital canary) is a **manual gate with documentary evidence**. Automated
metrics alone are insufficient.

## Pre-conditions (all must hold)

- [ ] `MODE=live` in `.env` is **not** set yet.
- [ ] A real Bybit API key pair exists with `withdrawalsDisabled=true`.
- [ ] The real key pair is distinct from the demo key pair (no reuse).
- [ ] `canary-live.json` exists, parses against `parseCanaryConfig`, and
      enforces bounded capital (≤ 1000 USD total, ≤ 25 USD/trade).
- [ ] `scripts/check-live-readiness.sh` exits 0.

## Required evidence bundle (exported from a demo session)

For at least one demo session of ≥ 24h, the bundle under
`reports/<sessionId>/` must contain:

- [ ] `audit.jsonl` — every state transition and risk decision.
- [ ] `evidence.json` — reconciliations, data-quality samples, kill-switch tests.
- [ ] `summary.json` — daily/weekly PnL, open orders, fill rate, slippage stats.
- [ ] `manifest.json` — config hash, runner version, session timeline.

## Review criteria (operator)

- [ ] No `HALT_SYSTEM` events triggered during demo run.
- [ ] Reconciliation resolved to 0 mismatches at session end.
- [ ] Audit reconstruction (`AuditReconstructor`) reproduces the full cycle
      from at least one `OrderIntent` to its fill and PnL.
- [ ] Loop stability: no orphan orders, no mode oscillations, no unscheduled
      mode demotions in the run log.
- [ ] Kill switch validated: manual TUI panic AND automatic drawdown
      trigger both transitioned to `HALT` and blocked new intents.

## Promotion command (only after all boxes are checked)

1. `bun run scripts/check-live-readiness.sh`  # must pass
2. `MODE=live` in `.env`, paste the **real** API key/secret.
3. `bun run start --mode live --config canary-live.json`
4. Monitor the first 10 cycles manually; abort via TUI on any anomaly.

## Rollback

- TUI panic button → `HALT` (immediate, audited).
- `Ctrl+C`/`SIGTERM` → graceful shutdown, manifest flushed.
- Revert `MODE` in `.env` to `demo` to exit live mode.
