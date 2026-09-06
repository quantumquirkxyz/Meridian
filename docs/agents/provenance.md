# Skill Provenance

This document records the origin and redesign status of the skills bundle. It exists to keep the method explicit, auditable, and portable.

## Provenance Classes

- **Original quirk:** authored in this repository for the quirk workflow.
- **quirk redesign:** based on an existing public or prior workflow shape, then rewritten, renamed, rerouted, or re-scoped into the quirk system.
- **Compatibility name retained:** a stable command name kept because it is useful to users, while the surrounding behavior belongs to this bundle.
- **Retired legacy alias:** an old name intentionally removed from active routing.

## Current System

The active workflow is:

```text
setup-quirk-skills
-> ask-to
-> grill-with-docs
-> to-spec
-> to-tickets
-> implement
-> publish-open-pr
-> review-pr
-> review-fix-loop
-> ship-subissue
```

## Retired Names

The following names are intentionally not active skills in this repository:

- `ask-matt`
- `setup-matt-pocock-skills`
- `doc-draft-pr`
- `ship-review-fix-loop`
- `frontend-development`
- `improve-codebase-architecture`

When a retired name represents useful behavior, the behavior has been routed through the active quirk vocabulary instead.

## Active Name Decisions

- `ask-to` replaces person-branded routing with a neutral quirk router.
- `setup-quirk-skills` replaces repo- or person-branded setup.
- `grill` is retained as a stable shorthand for the quirk questioning primitive.
- `grill-with-docs` is retained because it describes the useful behavior: question deeply while updating durable docs.
- `review-fix-loop` is the repair coordinator; it does not merge or close work.
- `plan-review-fixes` and `implement-review-fixes` remain separate so planning and mutation do not blur.

## Influence Policy

The bundle may be influenced by public skill patterns, GitHub workflow practices, ADR conventions, and prior repository workflows. Influence is acceptable when:

- active files are rewritten into this repository's method and vocabulary
- stale names and project-specific examples are removed
- provenance is recorded here
- validation confirms no legacy aliases remain in active routing

The point is not to hide influence. It is to turn influence into a distinct quirk system with its own vocabulary, template ownership, and delivery flow.

## 2026-09 — Sandbox-to-canonical promotion

- **Source:** `.skill-sandbox/` (experimental)
- **Outcome:** 33 new skills promoted to `.agents/skills/` with `.claude/skills/` symlinks.
- **Validation:** all 33 passed `skill-lab.mjs validate --json`; 2 pre-existing test skills (`test-skill`, `test-workflow-improvements`) failed and were excluded.
- **Categories covered:** Math (pure, applied, numerical, optimization, linear algebra, probability, crypto), Physics (quantum, classical, thermo, astro), Quant Finance (factors, backtest, derivatives, portfolio optimization, credit risk, market microstructure, risk, volatility), General Finance (DCF, corporate valuation, portfolio theory), Web3 (smart contracts, tokenomics, consensus, L2, DeFi, governance, privacy, DAOs), DB (relational, NoSQL, design, optimization, migration), SE (architecture, patterns, testing, DevOps, observability, security), CS (algorithms, complexity, distributed, formal methods), Documentation (ADR, audit, glossary, tech writing), Research (scientific hypothesis, experiment design, statistics, reproducibility), Professional Research (market analysis, competitive intel, user/product research).
- **Method:** contracts added (capabilities, outputs, stopCondition, risk, trustTier, Boundary), validated lot-by-lot, promoted via copy + symlink.
- **Status:** canonical bundle updated; provenance recorded.

## 2026-09 — Second promotion (Math + Physics specialist skills)

- **Source:** `.skill-sandbox/` (experimental)
- **Outcome:** 15 new skills promoted to `.agents/skills/` with `.claude/skills/` symlinks.
- **Validation:** all 15 passed `skill-lab.mjs validate --json`; 0 failures.
- **Categories:** Math (7: literature-track, formal-proof, computation-reproducible, teaching-problem-set, grant-structure, presentation-beamer, paper-collaboration); Physics (8: literature-search, experimental-notebook, simulation-setup, data-analysis-root, writing-revtex, talk-design, career-postdoc, reproducibility-archive).
- **Method:** contracts completed (capabilities/outputs/stopCondition/risk/trustTier/Boundary), validated lot-by-lot, promoted via copy + symlink.
- **Status:** canonical bundle updated; provenance recorded.

## 2026-09 — Third promotion (AI/ML, Security, DevOps, Data Eng, Product)

- **Source:** `.skill-sandbox/` (experimental)
- **Outcome:** 19 new skills promoted to `.agents/skills/` with `.claude/skills/` symlinks.
- **Validation:** all 19 passed `skill-lab.mjs validate --json`; 0 failures.
- **Categories:** AI/ML (4: ml-pipeline, prompt-engineering, model-evaluation, time-series-forecasting); Security (4: security-audit, threat-modeling, privacy-engineering, cryptography-applied); DevOps (5: k8s-orchestration, ci-cd-pipeline, sre-observability, terraform-iac, feature-flags); Data Eng (3: etl-pipeline, warehouse-modeling, streaming); Product (3: prd-writing, ab-testing, okr-planning).
- **Method:** contracts completed, trustTier fixed (medium → 3), validated batch, promoted via copy + symlink.
- **Status:** canonical bundle updated; provenance recorded.

## Maintenance Rule

When adding, renaming, or retiring a skill:

1. Update this provenance file.
2. Update `docs/agents/skills-map.md`.
3. Update or add scenario fixtures under `.agents/skills/evaluate-skill/scenarios/`.
4. Run `validate-skills.mjs`, `audit-semantics.mjs`, and `evaluate-scenarios.mjs`.
