# Skill Lab

The repository now includes a shared, dependency-free toolkit at
`.agents/skills/platform/skill-lab.mjs`. It gives the lab one machine-readable
contract for creating, validating, exploring, and measuring Skills.

```bash
node .agents/skills/platform/skill-lab.mjs template my-skill --domain testing
node .agents/skills/platform/skill-lab.mjs validate --json
node .agents/skills/platform/skill-lab.mjs graph --format mermaid
node .agents/skills/platform/skill-lab.mjs rules --json
node .agents/skills/platform/skill-lab.mjs diff old/SKILL.md new/SKILL.md
node .agents/skills/platform/skill-lab.mjs tutorial skill-tutor
node .agents/skills/platform/skill-lab.mjs metrics
node .agents/skills/platform/skill-lab.mjs playground
node .agents/skills/platform/skill-lab.mjs pr-check --base main
```

The commands are intentionally local and deterministic. The playground writes
only to an explicit temporary directory, and generated skills start in
`.skill-sandbox/` so they can be validated before promotion.
