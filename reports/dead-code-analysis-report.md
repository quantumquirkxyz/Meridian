# Codebase Dead Code & Redundancy Analysis — Meridian

**Scope:** `packages/{contracts,core,connectors,events,graph,harness,agents,infra,cli}` + root `test/`, `scripts/`, `demo.ts`
**Method:** `tsc --noUnusedLocals --noUnusedParameters` (intra-file unused imports/locals) + `ts-prune` (cross-file unused exports) + targeted `grep` verification to eliminate ts-prune false positives (barrel re-exports, `export *` surfaces, and TS keyword mis-parses).
**Note on library packages:** `contracts`, `core`, `connectors`, `events` use `export *` barrels, so every export is "public API." Symbols re-exported but not consumed in-repo are flagged as **disconnected public API**, not deleted blindly.

---

## 0. Executive summary (priority)

| # | Category | Severity | Root cause |
|---|----------|----------|------------|
| 1 | Fully orphaned module | HIGH | `core/src/multi-session.ts` not in barrel & never imported |
| 2 | Disconnected packages | HIGH | `infra`, `agents`, `harness` never imported by any other package |
| 3 | Unused `live/` module + duplicate config types | HIGH | `core/src/live/*` unused; CLI ships its own `BybitEndpoints`/`LiveRunnerConfig` |
| 4 | Legacy beta control surface superseded by gamma | HIGH | `contracts/beta-control.ts`, `infra/control-tui.ts`, `control-tui-ink.tsx`, `control-tui.test.ts` |
| 5 | Unwired LLM runtime adapters | MEDIUM | `agents/src/runtimes/{vercel,mastra}.ts` subpath exports, no in-repo consumer, LLM deps absent |
| 6 | Unused intra-file imports/locals | MEDIUM | 48 sites (tsc `noUnusedLocals`) |
| 7 | Single TODO marker | LOW | `gamma-session.ts:250` |

---

## 1. Código muerto — módulos/archivos huérfanos (definitivamente no exportados ni usados)

### 1.1 `core/src/multi-session.ts` — módulo huérfano completo  🔴 ALTA
- **Archivo:** `packages/core/src/multi-session.ts`
- **Líneas:** 8 (`SessionKey`), 10 (`MultiSessionOrchestrator`)
- **Detalle:** El archivo define `SessionKey` e `MultiSessionOrchestrator` pero **no aparece en el barrel de `core/src/index.ts`** (no hay `export * from "./multi-session.ts"`) y **no es importado por ningún archivo** del repo (grep 0 resultados fuera del propio archivo). Es código muerto 100%.
- **Recomendación:** Eliminar el archivo. Si la orquestación multi-sesión es un feature forward, re-exportarlo intencionalmente desde el barrel o borrarlo.

### 1.2 `core/src/live/` — módulo de runner "unificado" sin consumidor + tipos duplicados  🔴 ALTA
- **Archivo:** `packages/core/src/live/live-runner-types.ts` (+ `packages/core/src/live/index.ts`)
- **Símbolos no usados in-repo:** `RunnerMode` (14), `DEMO_ENDPOINTS` (24), `LIVE_ENDPOINTS` (31), `resolveEndpoints` (67), `resolveCanaryConfig` (79) — ts-prune los marca muertos y verificación grep confirma 0 consumidores.
- **Duplicación:** `core/src/live/live-runner-types.ts:17` define `BybitEndpoints` y `:41` define `LiveRunnerConfig`; el CLI define **sus propias versiones paralelas**: `BybitEndpoints` en `packages/cli/src/config.ts:24` y `LiveRunnerConfig` en `packages/cli/src/live-runner.ts:50`. El CLI **no importa** nada del módulo `core/src/live`.
- **Recomendación:** Unificar a una sola autoridad de los tipos de endpoints/config en `contracts` o `core` y borrar el duplicado del CLI; o bien borrar `core/src/live/` si se considera supersedido por el runner del CLI.

### 1.3 `agents/src/runtimes/{vercel.ts, mastra.ts}` — adapters LLM sin consumidor  🟠 MEDIA
- **Archivos:** `packages/agents/src/runtimes/vercel.ts`, `packages/agents/src/runtimes/mastra.ts`
- **Símbolos no usados in-repo:** `VercelAdapterConfig`(26), `VercelGenerateFn`(41), `VercelAISDKAdapter`(68), `MastraAdapterConfig`(27), `MastraGenerateFn`(44), `MastraAIAdapter`(76).
- **Detalle:** Declarados como *subpath exports* en `package.json` (`./runtimes/vercel`, `./runtimes/mastra`) pero **ningún paquete los importa** (grep 0). Además ninguna dependencia de LLM (`ai`, `@mastra`) está instalada en `node_modules` ni listada en `dependencies`; los adapters sólo importan tipos de `contracts` y `adapter.ts`.
- **Recomendación:** Si el adapter LLM es "Issue #26" planeado, documentarlo; si no, borrar los subpath exports y los archivos. También revisar que `agent.ts:43 isOutputKind` (ver §4) no tenga un consumidor esperado.

---

## 2. Paquetes completos desconectados (no consumidos por ningún otro paquete)  🔴 ALTA

Mapa de dependencias cruzadas (sólo `cli` está conectado a la cadena viva `core←cli`):

| Paquete | Dependencias | ¿Consumido por otro paquete? |
|---|---|---|
| `contracts` | — | ✅ sí (core/connectors/events/graph/agents/infra) |
| `core` | contracts | ✅ sí (cli) |
| `connectors` | contracts | ✅ sí (cli) |
| `events` | contracts | ✅ sí (harness) |
| `graph` | contracts | ✅ sí (`harness`) |
| `cli` | contracts, core, connectors | ⚠️ hoja de entrada (`bun run start`) |
| `harness` | contracts, events, graph | ❌ **NO** (sólo tests propios) |
| `agents` | contracts | ❌ **NO** (sólo tests propios + subpaths runtimes) |
| `infra` | contracts, events | ❌ **NO** (sólo tests propios) |

- **Recomendación:** Confirmar si `infra`, `agents` y `harness` son API pública futura (marcar explícitamente) o código muerto del que se puede prescindir. Mientras tanto no se eliminan, pero están fuera del camino de ejecución del CLI.

---

## 3. Archivos duplicados / redundantes  🔴 ALTA / 🟠 MEDIA

### 3.1 Superficie de control "beta" legada supersedida por "gamma"  🔴 ALTA
- `packages/contracts/src/beta-control.ts` (89 líneas) vs `packages/contracts/src/gamma-control.ts` (164 líneas).
- `packages/infra/src/control-tui.ts` (163 líneas) vs `packages/infra/src/gamma-control-tui.ts` (212 líneas) — estructura near-identical.
- `packages/infra/src/control-tui-ink.tsx` (BetaControlInkTui) — preview de TUI beta en `ink`/`react`, sin equivalente gamma, **no testeada** y fuera del barrel activo del CLI.
- **Consumidores beta:** `control-tui.ts` ↔ `beta-control.ts` ↔ `control-tui-ink.tsx` ↔ `control-tui.test.ts`.
- **Consumidores gamma:** `gamma-control-tui.ts` ↔ `gamma-control.ts` (sin test propio).
- ts-prune: `parseBetaControlCommand`, `isBetaControlStatus`, `isBetaControlResult` (beta-control.ts:45,54) **no son usados ni siquiera dentro de beta-control.ts** — dead dentro del propio archivo.
- **Recomendación:** Borrar la rama beta (`beta-control.ts`, `control-tui.ts`, `control-tui-ink.tsx`, `control-tui.test.ts`) dejando sólo `gamma-control.ts`/`gamma-control-tui.ts`; migrar/añadir tests gamma.

### 3.2 `BybitEndpoints` / `LiveRunnerConfig` duplicados (ver §1.2)  🔴 ALTA
- Definidos en `core/src/live/live-runner-types.ts` y rediseñados en `cli/src/config.ts:24` y `cli/src/live-runner.ts:50`.

---

## 4. Imports no usados / locales no usados (tsc `noUnusedLocals`)  🟠 MEDIA — ALTA

Verificados con `tsc --noUnusedLocals --noUnusedParameters`. Cada entrada incluye `file:línea`.

### contracts
| Archivo:línea | Símbolo | Tipo |
|---|---|---|
| `contracts/src/agent.ts:43` | `isOutputKind` | const local no usada |
| `contracts/src/regime.ts:8` | `isOptional` | import no usado |
| `contracts/src/risk.ts:2` | `isArrayOf` | import no usado |
| `contracts/src/route.ts:8` | `isOptional` | import no usado |
| `contracts/src/stategraph.ts:3` | `isBoolean` | import no usado |
| `contracts/src/stategraph.ts:16` | `isRiskReasonCode` | const no usada (se importa `isRiskReasonCode` de `reason-codes.ts`?) |
| `contracts/src/schema.ts:30` | `value` (parámetro) | parámetro no usado |

### core
| Archivo:línea | Símbolo | Tipo |
|---|---|---|
| `core/src/flow/simulated-flow.ts:3` | `AuditEvent` | import no usado |
| `core/src/gamma/audit-exporter.ts:24` | `ExportFormat` | import no usado |
| `core/src/gamma/audit-exporter.ts:276` | `options` (parámetro) | parámetro no usado |
| `core/src/gamma/audit-reconstructor.ts:161` | `nowMs` (parámetro) | parámetro no usado |
| `core/src/gamma/canary-session.ts:45` | `KillSwitchTrigger` | import no usado |
| `core/src/gamma/canary-session.ts:435` | `exitPrice` | local no usada |
| `core/src/gamma/canary-session.ts:524,572,581,588` | `statusBefore` | parámetro/local no usado (4 sitios) |
| `core/src/gamma/kill-switch.ts:17` | `CanaryConfig` | import no usado |
| `core/src/gamma/learning-engine.ts:24` | `StrategyPerformance` | import no usado |
| `core/src/gamma/live-execution-engine.ts:25` | `MarketSnapshot` | import no usado |
| `core/src/gamma/regime-classifier.ts:22` | `MarketRegime` | import no usado |
| `core/src/gamma/regime-policy-engine.ts:58` | `nowMs` (parámetro) | parámetro no usado |
| `core/src/gamma/route-engine.ts:583` | `snapshot` (parámetro) | parámetro no usado |
| `core/src/loop/loop-engine.ts:2` | `AuditReasonCode` | import no usado |
| `core/src/stategraph/guards.ts:3` | `DataQualityReport` | import no usado |
| `core/src/stategraph/state-graph.ts:72` | `nodes` (parámetro) | parámetro no usado |
| `core/src/stategraph/state-graph.ts:253` | `timestampMs` (parámetro) | parámetro no usado |

### agents
| Archivo:línea | Símbolo | Tipo |
|---|---|---|
| `agents/src/behavioral-runtimes.ts:11` | `AgentMessage` | import no usado |
| `agents/src/runtimes/mastra.ts:16` | `AgentMessage` | import no usado |
| `agents/src/runtimes/mastra.ts:20` | `SchemaValidationResult` | import no usado |
| `agents/src/runtimes/vercel.ts:19` | `SchemaValidationResult` | import no usado |

### cli
| Archivo:línea | Símbolo | Tipo |
|---|---|---|
| `cli/src/index.ts:20` | `LiveRunnerConfig` | import no usado (tipo) |
| `cli/src/index.ts:22,23` | `mkdirSync, writeFileSync, dirname` | imports de `node:fs`/`node:path` no usados |
| `cli/src/index.ts:109` | `printSessionSummary` | función definida pero nunca llamada |
| `cli/src/live-runner.ts:470` | `intent` | parámetro no usado |

### connectors
| Archivo:línea | Símbolo | Tipo |
|---|---|---|
| `connectors/test/bybit-integration.test.ts:135` | `expectedSignature` | local no usada |
| `connectors/test/bybit-ws.test.ts:434` | `ws` | local no usada |

### graph
| Archivo:línea | Símbolo | Tipo |
|---|---|---|
| `graph/src/pathfinding.ts:21` | `EdgeWeights` | import no usado |
| `graph/src/pathfinding.ts:24` | `RiskReasonCode` | import no usado |
| `graph/src/quality.ts:4` | `MarketEdge` | import no usado |

### harness
| Archivo:línea | Símbolo | Tipo |
|---|---|---|
| `harness/src/backtest.ts:23` | `SeededRng` | import no usado |
| `harness/src/backtest.ts:116` | `fundingSim` | local no usada |
| `harness/src/simulators/fill.ts:134` | `fillPrice` | local no usada |
| `harness/src/stress.ts:167` | `snapshot` | import no usado |
| `harness/src/stress.ts:191` | `fundingSim` | local no usada |

- **Recomendación:** Limpiar todos los imports/locales listados (eliminar o usar). Algunos imports no usados (`StrategyPerformance`, `MarketSnapshot`, `AuditEvent`, `DataQualityReport`, etc.) indican code where a refactorización dejó importaciones huérfanas de símbolos que tal vez debían usarse — revisar la intención.

### Tests (no incluidos en el criterio de "muerto", pero listados para limpieza)
| Archivo:línea | Símbolo |
|---|---|
| `agents/test/agents.test.ts:6,7,8,30,31` | `isAgentInput, isAgentOutput, isAgentRunResult, AgentAdapter, SchemaValidationResult` |
| `agents/test/smoke.test.ts:6,7,8` | `isAgentRunResult, isAgentRuntimePolicy, isAgentFallback` |
| `cli/test/entry.test.ts:2` | `CliArgs, CliArgsError` |
| `contracts/test/agent-contracts.test.ts:18` | `AgentOutput` |
| `contracts/test/data-quality-scoring.test.ts:9` | `DEFAULT_SCORING_THRESHOLDS` |
| `contracts/test/contracts.test.ts:453` | `ctx` |
| `core/test/* ` varios | `DEFAULT_EXPORT_OPTIONS, GammaSessionSummary, makeLosingEntry, LoopOutput, Permission, PermissionRegistry, buildDefaultGraph, DEFENSIVE_STATES, RegimeClassification, RegimePolicy, SystemMode, StateGraph` |
| `graph/test/market-graph.test.ts:5,6,7` | `MarketNode, MarketEdge, MarketGraphSnapshot` |
| `graph/test/cycle-detection.test.ts:5,7` | `findArbitrageCycles, computeRouteCost` |
| `graph/test/pathfinding.test.ts:145` | `snap` |
| `harness/test/backtest.test.ts:2,3` | `BacktestResult, createSeededRng` |
| `harness/test/stress.test.ts:4,5,89` | `StressReport, StressScenario, normal` |
| `infra/test/infrastructure-engine.test.ts:16` | `ONE_MIN` |

---

## 5. Inconsistencias, exportaciones y símbolos huérfanos (ts-prune verificado)

### 5.1 Types/constants definidos pero no exportados ni usados
| Archivo:línea | Símbolo | Comentario |
|---|---|---|
| `core/src/multi-session.ts:8,10` | `SessionKey, MultiSessionOrchestrator` | No en barrel, 0 imports (§1.1) |
| `core/src/live/live-runner-types.ts:14,24,31,41,67,79` | `RunnerMode, DEMO_ENDPOINTS, LIVE_ENDPOINTS, LiveRunnerConfig(core), resolveEndpoints, resolveCanaryConfig` | barrel `export *` sí los publica, 0 consumidores in-repo (§1.2) |
| `contracts/src/beta-control.ts:45,54` | `isBetaControlCommand, isBetaControlStatus, isBetaControlResult` | 0 uso incluso dentro del archivo (beta legacy) |
| `contracts/src/audit-reconstruction.ts:335` | `parseAuditAvailability` | 0 consumos in-repo (ts-prune verificado; public API vía `export *`) |
| `contracts/src/infrastructure.ts` | `isSecretRecord, isBackupRecord, isErrorBudgetStatus, isErrorBudgetConfig` | 0 consumos in-repo (public API vía `export *`) |

> **Nota ts-prune:** varios símbolos aparecen "muertos" por problemas de resolución del *bundler moduleResolution* con extensiones `.ts`; varios de la lista original de ts-prune (`ReportGenerator`, `DEFAULT_AUDIT_AVAILABILITY`, `SIGNAL_MODES`, `EXECUTION_MODES`, `MarketState`, `TradeRecord`, `computeSharpe`, etc.) resultan en **uso real** y no son muertos. La tabla sólo incluye los verificados por `grep` a 0 consumos.

### 5.2 Símbolos "usados" pero dentro de paquetes desconectados
`infra` es un paquete hoja: `isInfrastructureStatus`/`DEFAULT_INFRASTRUCTURE_CONFIG`/`isErrorBudgetStatus` se usan **solo dentro de `infra`** (`infrastructure-engine.ts`), pero `infra` no es importado por el CLI ni por `core`. Por tanto son "vivos dentro de un paquete muerto".

### 5.3 `infra` TUI models: cobertura de tests desigual
- `infra/src/control-tui.ts:110` define `BetaControlTuiModel` (barrel infra/index.ts:21) — **testado** por `control-tui.test.ts`.
- `infra/src/gamma-control-tui.ts:159` define `GammaControlTuiModel` — **sin tests**.

---

## 6. Código comentado

- **No se encontraron bloques de código comentado muerto.** La búsqueda (`^\s*//\s*(import|const|let|return|if|for|...)`) no arrojó resultados; única coincidencia es un comentario descriptivo en `core/test/stategraph.test.ts:265` ("forwards a stale past timestamp..."), no es código muerto.

---

## 7. TODOs / FIXMEs / notas pendientes

| Archivo:línea | Texto |
|---|---|
| `core/src/gamma/gamma-session.ts:250` | `// TODO(#125): connect AgentAdapter for typed agent observations.` |

- Único TODO/FIXME/HACK hallado en packages. Recomendación: vincular a issue #125 y either implementar o mover a backlog.

---

## 8. Recomendaciones de prioridad

**Alta (accion inmediata):**
1. Borrar `packages/core/src/multi-session.ts` (huérfano total) o exportarlo deliberadamente.
2. Decidir destino de `packages/core/src/live/` — unificar tipos `BybitEndpoints`/`LiveRunnerConfig` con el CLI o borrar el módulo; eliminar duplicado.
3. Borrar la rama beta de control (`beta-control.ts`, `control-tui.ts`, `control-tui-ink.tsx`, `control-tui.test.ts`) dejando `gamma-control.ts`/`gamma-control-tui.ts`; añadir tests gamma.
4. Confirmar/hacer explícito el estado de `infra`, `agents`, `harness` (API futura vs. código muerto).

**Media:**
5. Limpiar los 35 imports/locals no usados de src (§4) y los de tests.
6. Revisar intención de imports huérfanos de contracts (`isOutputKind`, `isOptional`, `isArrayOf`, `isBoolean`, `isRiskReasonCode`) — podrían indicar que tipos/validators no están conectados.
7. Resolver el único TODO (#125) o migrarlo al tracker.

**Baja:**
8. Verificar subpath exports `./runtimes/*` de agents y su relación con Issue #26.
