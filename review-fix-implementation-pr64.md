## Review Fix Implementation

Status: implemented

### Completed

- Route inventory-blocked orders through deterministic risk decisions -> added an `inventoryBlocked` risk-gate path so the Beta session now asks the Risk Engine for the fail-closed REJECT decision instead of fabricating it locally; the session still blocks `EXECUTE_ORDER` and records the inventory reasons on the risk decision/report.

### Validation

- `bun test packages/core/test/beta-paper-trading-session.test.ts packages/core/test/risk-gate.test.ts` -> passed
- `bun test packages/infra/test/control-tui.test.ts test/boundaries.test.ts` -> passed
- `bun run typecheck` -> passed
- `bun test` -> passed
- `git diff --check` -> passed

### Remaining

None
