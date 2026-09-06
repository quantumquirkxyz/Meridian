# Example Pull Request Body

## Summary

Adds a deterministic semantic audit to the quirk skills platform.

## Why

The bundle needs checks that catch retired aliases, weak templates, stale links, and lock drift before adoption into another repo.

## Impact

Maintainers get a single validation path that catches both mechanical and semantic drift.

## Validation

- `node .agents/skills/platform/check-all.mjs` -> pass

## Review Focus

Audit rules for retired terms and template markers.

## Notes

No runtime dependencies were added.

## Development

Closes #123
