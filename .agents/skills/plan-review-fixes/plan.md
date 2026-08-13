## Review Fix Plan

Status: planned
Review: `main...issue-100-be-2-openapi-spec-update`

### Standards

- [ ] Fix commit message to follow Conventional Commits
  - Finding: Commit `BE-2: Update OpenAPI spec to reflect real backend contracts` lacks the required `type(scope):` prefix. CONTRIBUTING.md line 186. Hard violation.
  - Fix: Amend the commit message to `docs(openapi): update spec to reflect real backend contracts`
  - Validate: `git log -1 --format=%s`

### Spec

No planned fixes. The pre-existing OpenAPI lint errors (17 errors, 109 warnings) are not introduced by this change and are out of scope. The `updatedAt` removal from `Conversation` was not in the explicit requirements list but is justified by the AC "match the backend interface."

### Notes

The remaining standards smells (Duplicated Code — `$ref` pattern repeated with `SharedInterest`, Divergent Change — one commit touching two schema areas, Primitive Obsession — timestamps without `format: date-time`) are judgement calls that don't warrant fixes for this small diff.
