# Skills Platform

Shared resources for the repository-local Skills platform.

- `manifest.schema.json` defines the minimum machine-readable contract for a Skill.
- `artifact.schema.json` defines the shared envelope for cross-skill artifacts.
- `context-packs.md` defines the context-pack concept and read-order rules.
- `execution-policy.md` defines the side-effect policy surface.
- `registry.md` defines the canonical registry vocabulary.
- `validate-skills.mjs` checks `.agents/` canonicality, `.claude/` parity, and lock coverage.
- `audit-semantics.mjs` checks retired names, weak template markers, dependencies, Markdown links, and lock drift.
- `evaluate-scenarios.mjs` checks scenario fixtures for route, phrase, reference, and side-effect expectations.
- `evaluate-behavioral-fixtures.mjs` checks representative artifact outputs for required sections.
- `check-all.mjs` runs the full validation gate.
- `sync-bundle.mjs` dry-runs or applies bundle sync into another repository.
