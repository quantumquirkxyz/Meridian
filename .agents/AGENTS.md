# Repository Agent Skills

This directory is the repository-local, tool-agnostic Agent Skills bundle. It
is compatible with Codex-style Agent Skills and Claude Code.

- `.agents/skills/` is canonical and version-controlled.
- Each skill is a self-contained directory with `SKILL.md` and any companion resources.
- `skills-lock.json` records upstream provenance, revisions, and hashes.
- `.claude/skills/` is only a compatibility view made of relative symlinks.

Use the root `AGENTS.md` for repository-specific guidance and routing.
