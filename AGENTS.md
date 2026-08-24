## Agent skills

Use the shared skills bundle, but keep routing aligned with Meridian's trading infrastructure domain.

### Issue tracker

Issues and PRDs live as GitHub issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles mapped to GitHub labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Routing

- Bugs, failures, regressions, or performance issues in CEX/DEX trading infrastructure -> `diagnosing-bugs`.
- Test-first changes to execution, routing, or risk code -> `tdd`.
- New trading, execution, or agent feature after discussion -> `to-spec`, then `implement`.
- Multi-session planning for market connectivity or execution architecture -> `wayfinder`.
- Architecture, module boundaries, or interface design -> `codebase-design`.
- Domain language, invariants, and ADRs for market graph, execution, and risk -> `domain-modeling`.
- Market or protocol research -> `research`.
- Review work -> `code-review` or `review-pr`.
- Dirty PR review that should be driven to clean -> `review-fix-loop`.
- Review-fixed PR that should be merged, closed, and synced with tracker metadata -> `ship-review-fix-loop`.
- Unclear plan or decision -> `grill-me` or `grill-with-docs`.
