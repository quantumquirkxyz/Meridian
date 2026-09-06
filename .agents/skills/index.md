# Skills — Índice navegable

> reorganizado 2025-01 | 72 skills | 8 categorías

---

## Por categoría

### 🏗️ `foundation/` — vocabulario y patrones compartidos
| Skill | Descripción | Madurez |
|-------|-------------|---------|
| `codebase-design/` | Vocabulario para diseñar módulos profundos | stable |
| `domain-modeling/` | Construir y afinar el modelo de dominio | stable |
| `api-design/` | Diseñar seams API pequeños y duraderos | stable |
| `observability/` | Logs, metrics, traces y alertas en producción | stable |
| `agent-observability/` | Capturar registros de ejecución de skills | stable |

### 🛠️ `skill-dev/` — crear y mantener skills
| Skill | Descripción | Madurez |
|-------|-------------|---------|
| `skill-creator/` | Guía para crear skills efectivas | stable |
| `skill-template-generator/` | Generar templates de skill | sandbox |
| `skill-sandbox/` | Iterar skills en entorno aislado | stable |
| `skill-promoter/` | Promover skills experimentales a canónico | stable |
| `skill-testing-framework/` | Validar estructura y contratos de skills | stable |
| `skill-performance-metrics/` | Métricas de ejecución de skills | experimental |
| `skill-dependency-graph/` | Grafo de dependencias entre skills | experimental |
| `skill-diff-analyzer/` | Comparar versiones de skills | experimental |
| `skill-audit/` | Auditar modularidad y deuda de skills | experimental |
| `writing-great-skills/` | Guía de estilo para skills | experimental |
| `skill-tutor/` | Tutorial interactivo de creación | stable |
| `evaluate-skill/` | Evaluar forma y encaje de una skill | experimental |

### 🚀 `delivery/` — ciclo de ejecución
| Skill | Descripción | Madurez |
|-------|-------------|---------|
| `implement/` | Implementar a partir de spec o tickets | stable |
| `prototype/` | Construir prototipos de descarte | stable |
| `research/` | Investigar temas contra fuentes primarias | stable |
| `testing/` | Estrategia de testing por proyecto | stable |
| `tdd/` | Desarrollo guiado por tests | stable |
| `webapp-testing/` | Tests para web apps (unit/integration/e2e) | stable |
| `code-review/` | Revisar cambios contra estándares y spec | stable |
| `review-pr/` | Publicar hallazgos de PR en GitHub | stable |
| `plan-review-fixes/` | Planificar remediación de review | stable |
| `implement-review-fixes/` | Aplicar correcciones de review | stable |
| `review-fix-loop/` | Bucle PR repair: review → plan → fix | stable |
| `resolving-merge-conflicts/` | Resolver conflictos de rama | stable |
| `diagnosing-bugs/` | Loop de diagnóstico de bugs duros | stable |
| `contribution-workflow-optimizer/` | Optimizar workflow de contribución | experimental |

### 🏗️ `platform/` — infraestructura y deployment
| Skill | Descripción | Madurez |
|-------|-------------|---------|
| `deployment/` | Build, release y rollback como seam seguro | stable |
| `release-management/` | Planificar release train y CI | stable |
| `vercel/` | Deployment y runtime en Vercel | experimental |
| `queueing/` | Background processing y message flow | stable |
| `postgres/` | Decisiones de schema y query PostgreSQL | stable |
| `database-migrations/` | Planificar cambios de schema | stable |
| `monitoring-alerting/` | Alerts, dashboards y señales runtime | stable |

> ⚠️ `platform/` contiene archivos auxiliares (`schemas/`, `tests/`, `runs/`, `*.mjs`) que no son skills.

### 🎨 `frontend/` — UI y experiencia
| Skill | Descripción | Madurez |
|-------|-------------|---------|
| `frontend-design/` | Sistema visual, modelo de interacción | stable |
| `react/` | Componentes React composables y testeables | stable |
| `nextjs/` | Rutas, server/client seams en Next.js | experimental |
| `design-system/` | Tokens, componentes y reglas reutilizables | stable |
| `mobile/` | Restricciones device, offline, platform seams | stable |

### 🔌 `integrations/` — APIs y servicios externos
| Skill | Descripción | Madurez |
|-------|-------------|---------|
| `api-contracts/` | Request/response contracts y versionado | stable |
| `auth/` | Autenticación y autorización como seam explícito | stable |
| `payments/` | Flujos de pago con rollback y reconciliación | stable |
| `search/` | Comportamiento de búsqueda e indexing | stable |

### 📋 `project/` — gestión de trabajo
| Skill | Descripción | Madurez |
|-------|-------------|---------|
| `project-development/` | Evaluar forma y arquitectura inicial | stable |
| `make-project/` | Crear board en GitHub Projects | stable |
| `to-spec/` | Convertir idea a spec estructurada | stable |
| `to-tickets/` | Dividir spec en tickets ejecutables | stable |
| `docs-management/` | Mantener docs y ADRs alineados | stable |

### 🔀 `routing/` — control de flujo y handoff
| Skill | Descripción | Madurez |
|-------|-------------|---------|
| `grill/` | Gritar al usuario para stress-testear ideas | stable |
| `grill-me/` | Auto-grilling para ideas propias | experimental |
| `grill-with-docs/` | Gritar con documentación como input | experimental |
| `grilling/` | Alias/redirect a grill | stable |
| `handoff/` | Handoff explícito entre agentes | stable |
| `artifact-handoff/` | Transferir artifacts entre skills | stable |
| `ask-to/` | Delegar decisión al usuario | stable |
| `triage/` | Clasificar y priorizar issues | experimental |
| `capability-router/` | Routing por capacidad de skill | experimental |
| `context-pack/` | Paquetes de contexto reusable | experimental |
| `wayfinder/` | Navegar entre skills por intención | experimental |
| `work-item-router/` | Routing de work items | experimental |
| `publish-open-pr/` | Publicar PR abierto desde branch | stable |
| `ship-subissue/` | Mergear PR y cerrar issue | stable |
| `knowledge-curator/` | Curar conocimiento organizacional | experimental |

---

## Por tag

| Tag | Skills |
|-----|--------|
| `#api` | api-design, api-contracts |
| `#frontend` | react, nextjs, frontend-design, design-system |
| `#database` | postgres, database-migrations |
| `#deployment` | deployment, vercel, release-management |
| `#testing` | testing, tdd, webapp-testing |
| `#skill-dev` | skill-*, evaluate-skill |
| `#workflow` | review-pr, plan-review-fixes, implement-review-fixes |
| `#routing` | capability-router, work-item-router, wayfinder |
| `#payment` | payments |
| `#auth` | auth |
| `#observability` | observability, agent-observability, monitoring-alerting |

---

## Por madurez

| 🧪 experimental | 🔬 sandbox | ✅ stable | ⚠️ deprecated |
|-----------------|------------|-----------|---------------|
| skill-performance-metrics | skill-template-generator | codebase-design | (ninguna) |
| skill-dependency-graph | | domain-modeling | |
| skill-diff-analyzer | | api-design | |
| skill-audit | | observability | |
| writing-great-skills | | agent-observability | |
| contribution-workflow-optimizer | | ... y la mayoría | |
| vercel | | | |
| triage | | | |
| capability-router | | | |
| context-pack | | | |
| wayfinder | | | |
| work-item-router | | | |
| knowledge-curator | | | |
| grill-me | | | |
| grill-with-docs | | | |

---

## No categorizadas

| Skill | Notas |
|-------|-------|
| `setup-qquirk-skills/` | Script utilitario, no skill estándar |

---

*Generado automáticamente — no editar a mano*

## Áreas añadidas (2025-09-06)
- backend (backend-architecture, microservices)
- ux (ux-research, interaction-design)
- qa (qa-automation, performance-testing)
- accessibility
- iot (iot-embedded)
- networking
- compilers
- os (os-kernel)
- cms (cms-architecture, localization)
- xr (xr-development)
