# Skill Style Guide

Use this guide when editing or adding quirk Skills.

```mermaid
flowchart LR
    A[Edit skill] --> B[Check frontmatter]
    B --> C[Check body shape]
    C --> D[Check language]
    D --> E[Check templates]
    E --> F[Run check-all.mjs]
    F --> G[Publish]
```

## Frontmatter

- `name` matches the folder name.
- `description` states what the skill does and when to use it.
- `capabilities`, `inputs`, `outputs`, `sideEffects`, `stopCondition`, and `risk` must match behavior.
- A skill that writes code, tracker state, branches, PRs, or docs is not `risk: low` unless the write is purely local and explicitly harmless.
- `trustTier` must be declared and must align with `risk`:
  - Tier 1 — metadata/routing only (`ask-to`, `capability-router`)
  - Tier 2 — read-only analysis or documentation (`review-pr`, `research`, `domain-modeling`)
  - Tier 3 — supervised local writes (`implement`, `tdd`, `to-spec`, `plan-review-fixes`)
  - Tier 4 — autonomous remote writes (`publish-open-pr`, `ship-subissue`, `review-fix-loop`)
- `maxIterations` is required on any skill whose body contains an explicit or implicit repeat/loop. Omit it only when the skill is `disable-model-invocation: true` or the body contains no loop at all.

## Body Shape

- Start with the purpose and boundary.
- Include a `Contract` section for non-trivial skills.
- Include ordered steps only when sequence matters.
- Include completion criteria that are checkable.
- Push mode-specific details into references instead of bloating `SKILL.md`.

## Language

- Use quirk vocabulary from `CONTEXT.md` and `docs/agents/quirk-method.md`.
- Avoid person-branded names and repository-specific examples.
- Prefer "source of truth", "scope", "validation", "owner", and "next consumer" over vague status language.

## Templates

- Follow the template owned by the skill you are editing, and keep shared artifact principles in `docs/agents/skill-templates.md`.
- Treat the skill-specific template as the source of truth for shape, and keep the repository-level index as the map, not the contract.
- Published artifacts must not contain placeholders.
- Use examples only when they are generic or clearly marked as examples.
- If a skill produces a new durable artifact shape, add a new skill-owned reference instead of teaching the whole repo a new generic template.

## Validation

After every skill edit:

```bash
node .agents/skills/platform/check-all.mjs
```
