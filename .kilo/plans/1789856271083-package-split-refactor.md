# Plan: Package Split Refactor for Meridian Core/Agents/Infra

**Status:** Partial completion — subpath exports added; full package split is optional follow-up.  
**Created:** 2026-09-20

---

## 1. Context

The `docs/CODEBASE_DESIGN_ANALYSIS.md` identified barrel antipatterns in `core` (30+ exports), `agents` (15+ exports), and `infra` (5+ exports) as scalability risks. Subpath exports have been added to each package (committed) to reduce the caller's interface surface without file moves.

**Decision point:** Is the full package split worth the additional risk and effort, or is the subpath-export fix sufficient?

---

## 2. Current State (Completed)

| Item | Status | Commit |
|------|--------|--------|
| `grossSpreadUsd` canonical source in `computeRouteCost` | **Done** | `ef1a55c` |
| Gas price configurable in `DEXExecutor` | **Done** | `4c87238` |
| `maxNodes` deterministic in cycle detection | **Done** | `01e889f` |
| Merge `core/src/stategraph/*` into single module | **Done** | `aef1c6f` |
| Subpath exports for `core`, `agents`, `infra` | **Done** | `a07f25b` |
| Cleanup: delete stale stategraph files | **Done** | `636112c` |

---

## 3. Remaining Work (Optional)

### 3.1 Full package split: `core` → sub-packages

**Rationale:** Enables independent build, test, and versioning per concern. Currently `bun test` in `core` runs all 450+ tests even when only risk-gate changes.

**Target structure:**
```
packages/
  core-stategraph/     # StateGraph, Orchestrator, PermissionRegistry, guards, topology
  core-risk/           # RiskEngine, risk-gate, price-oracle, mev-protection, bridge-manager
  core-reconciliation/ # ReconciliationEngine, reconciliation
  core-execution/      # SimulatedExecutionEngine, LiveExecutionEngine, KillSwitch, trade-record
  core-session/        # TradingSession, LiveRunner, RouteEngine, OpportunityDetector, CanarySession, RegimeClassifier
  core-inventory/      # InventoryEngine, slippage utils, market-state utils
```

**Dependency graph (post-split):**
```
contracts → core-stategraph, core-risk, core-execution, core-reconciliation, core-inventory
contracts + graph → core-session
core-stategraph → core-session (LiveRunner imports StateGraph)
core-risk, core-execution, core-reconciliation, core-inventory, core-session → cli
```

**Risk:** `cli` imports from `@agenttrading/core` today (5 imports). Each import would need to change to the specific sub-package. All internal imports within `core` that cross sub-package boundaries would also need updating.

**Files to move:** ~30 source files + ~20 test files + `package.json`/`tsconfig.json` per new package.

### 3.2 Full package split: `agents` → sub-packages

**Target structure:**
```
packages/
  agents-core/    # adapter, config, registry, memory, logger, budget, runtime
  agents-catalog/ # catalog, behavioral-runtimes, deployment
  agents-general/ # general-agent (THE deep module)
  agents-runtimes # vercel, mastra, openrouter (already subpath exports)
```

**Risk:** `agents` already has the boundary rule (never imports core). Splitting into packages would need to preserve this. Tests in `agents/test/` would need to be split across sub-packages.

### 3.3 Full package split: `infra` → sub-packages

**Target structure:**
```
packages/
  infra-observability/ # observability-service, data-quality-monitor
  infra-opportunity/    # opportunity-recorder
  infra-control/        # infrastructure-engine, canary-control-tui
```

**Risk:** Low — `infra` is only consumed by `cli` (5 imports). Moving TUI to `cli` should be considered (ADR-0010 says infra owns it, but separation of concerns suggests the TUI belongs in the wiring layer).

### 3.4 Regime classifier threshold calibration

**Status:** No code change required. Requires backtest data to calibrate regime switch thresholds. This is a data science task, not a refactoring.

---

## 4. Recommendation

**Stop here.** The subpath exports fully address the barrel antipattern: callers now import from `@agenttrading/core/risk` instead of `@agenttrading/core`, learning only the RiskEngine interface. Full package extraction is a large, risky change (50+ file moves, dependency graph rewiring across all packages) with diminishing returns over what's already done.

If the team wants independent package builds (for CI speed), it can be done as a separate PR after confirming demand.

**Next priority after this checkpoint:** Regime classifier threshold calibration using backtest data — this has real financial impact and is the highest-ROI remaining item from the analysis.

---

## 5. Validation Steps (for any follow-up work)

1. `bun run typecheck` — must pass with 0 errors
2. `bun test` — must pass all 1223 tests
3. `bun test --filter packages/<new-package>/` — verify sub-package isolation
4. Verify no imports of `@agenttrading/core` in `cli/src/` without a subpath suffix
5. Verify the dependency boundary rules still hold (`agents` never imports `core`, `core` never imports LLMs/connectors)

---

## 6. Out of Scope

- Regime threshold calibration (requires market data/backtest output)
- Full package extraction (deferred — subpath exports address the core issue)
- Hardcoded gas oracle (ADR-0006 follow-up, out of scope for this layer)
- MaxNodes default tuning (current fix makes it deterministic; threshold tuning needs market data)
