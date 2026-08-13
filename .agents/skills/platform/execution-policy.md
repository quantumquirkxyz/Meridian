# Execution Policy

Default policy surface for Skills:

- `read`: allowed
- `write`: allowed only when the Skill manifest declares a write side effect
- `delete`: requires explicit approval or a dedicated deletion skill
- `network`: requires explicit approval unless the Skill is a documented research or integration skill
- `github`: requires explicit approval for writes
- `secrets`: never print tokens or private credentials
- `pii`: redact by default
- `rollback`: every write-capable flow must name a rollback path

Any Skill that mutates state should declare its side effects and stop condition.

