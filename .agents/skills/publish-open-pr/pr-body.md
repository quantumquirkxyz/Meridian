## Summary

Update `docs/openapi.yaml` to match the real backend contracts after BE-1 added `sharedInterests` to matching responses.

## Why

The OpenAPI spec was out of sync with the backend types — `Conversation` used old field names (`participants`, `lastMessage`) and matching response types were missing `sharedInterests`.

## Impact

API consumers and spec-readers see an accurate contract instead of stale stubs.

## Validation

- `git diff --check` — no whitespace errors.
- `redocly lint docs/openapi.yaml` — 17 errors, 109 warnings, identical to `main` (all pre-existing, none introduced by this change).

## Issue Traceability

- Related issue: #100
- Issue title: BE-2: Update OpenAPI spec to reflect real backend contracts
- Issue URL: https://github.com/quantumquirkxyz/ARIES/issues/100
- Issue labels: `ready-for-agent`
