# Provenance Inventory

This file classifies active skills by provenance status. Use `docs/agents/provenance.md` for retired names and naming rationale.

## Original quirk System Skills

- `ask-to`
- `project-development`
- `context-pack`
- `capability-router`
- `artifact-handoff`
- `agent-observability`
- `execution-policy`
- `skill-audit`
- `evaluate-skill`
- `knowledge-curator`
- `docs-management`

## quirk Delivery Workflow

- `to-spec`
- `to-tickets`
- `implement`
- `publish-open-pr`
- `review-pr`
- `review-fix-loop`
- `plan-review-fixes`
- `implement-review-fixes`
- `ship-subissue`
- `make-project`
- `work-item-router`

## quirk Design and Quality Skills

- `domain-modeling`
- `codebase-design`
- `tdd`
- `testing`
- `webapp-testing`
- `diagnosing-bugs`
- `research`
- `prototype`
- `handoff`
- `resolving-merge-conflicts`
- `code-review`

## Compatibility Names Retained

- `grill`
- `grilling`
- `grill-me`
- `grill-with-docs`

## Platform and Stack Specializations

- `frontend-design`
- `design-system`
- `api-design`
- `api-contracts`
- `auth`
- `database-migrations`
- `deployment`
- `release-management`
- `monitoring-alerting`
- `observability`
- `nextjs`
- `react`
- `vercel`
- `postgres`
- `payments`
- `queueing`
- `search`
- `mobile`

## Maintenance

When a skill changes category, update this file and rerun `node .agents/skills/platform/check-all.mjs`.
