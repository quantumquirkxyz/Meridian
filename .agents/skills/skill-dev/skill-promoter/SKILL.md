---
name: skill-promoter
category: skill-dev
maturity: stable
version: 1
description: Promote validated experimental skills from the sandbox to the canonical skills bundle.
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact or structured result
outputs:
  - Markdown artifact with process steps and completion criteria
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved; criteria met.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem or task defined by the skill body.
- **Output:** Markdown artifact or structured result with completion criteria met.
- **Side effects:** none (design/review/documentation only unless explicitly stated).
- **Dependencies:** none (self-contained unless linked to other skills).
- **Stop condition:** all process steps completed; artifact saved; criteria checked.
- **Risk:** low.
- **Boundary:** produces reasoning or documentation artifacts; does not modify external systems unless explicitly instructed.


# Skill Promoter

Use this skill to promote validated experimental skills from the sandbox to the canonical skills bundle.

## Contract

- Input: skill name, validation report, and promotion criteria
- Output: promoted skill in canonical bundle, updated symlinks, updated lockfile, and promotion report
- Scope: promotion of skills that have passed sandbox validation
- Rule: skills can only be promoted after passing all validation checks in the sandbox
- Rule: promotion includes updating .agents/skills/, .claude/skills/, and skills-lock.json
- Rule: promotion requires maintaining backward compatibility and following provenance guidelines

## Process

### 1. Validate Sandbox Skill

Before promotion, ensure the skill is ready:
- Run validation scripts on the sandbox skill
- Check for any warnings or errors in the validation report
- Verify that the skill follows the skill-style-guide
- Confirm that the skill has clear boundaries and distinct capabilities
- Ensure the skill includes proper documentation and examples

### 2. Prepare for Promotion

Get the skill ready for the canonical bundle:
- Create the skill directory in .agents/skills/
- Copy the SKILL.md and any associated files (references/, scripts/)
- Ensure the skill follows the exact structure expected by canonical skills
- Verify that dependencies are correctly declared and resolvable in the main bundle

### 3. Update Canonical Bundle

Move the skill to its permanent location:
- Copy the skill directory to .agents/skills/<skill-name>/
- Create the symlink in .claude/skills/<skill-name> pointing to ../../.agents/skills/<skill-name>
- Update skills-lock.json with the skill's information and hash
- Run the full validation suite (check-all.mjs) to ensure nothing is broken

### 4. Record Provenance

Document the skill's journey:
- Add an entry to docs/agents/provenance.md documenting the promotion
- Include the skill name, promotion date, and rationale
- Note any influences from the sandbox experimentation phase
- Update the skills-map.md if the skill represents a new category

### 5. Verify Promotion

Confirm the promotion was successful:
- Run check-all.mjs to ensure the bundle is still valid
- Verify that the skill can be invoked and functions correctly
- Check that the .claude/skills/ symlink works properly
- Confirm that the skill appears in the skills registry

## Completion Criteria

- The skill has been copied to .agents/skills/<skill-name>/
- The symlink has been created in .claude/skills/<skill-name>
- The skills-lock.json has been updated with the skill's information
- The full validation suite passes (check-all.mjs returns status: "pass")
- The skill has been documented in provenance.md
- A promotion report has been generated with the outcome and rationale

## Promotion Criteria

A skill should only be promoted when:

1. **Clear Need**: The skill addresses a repeatedly useful behavior not adequately covered by existing skills
2. **Distinct Boundaries**: The skill has clear boundaries and doesn't significantly overlap with existing skills
3. **Quality Standard**: The skill passes all validation checks with no errors
4. **Documentation**: The skill includes proper documentation following the skill-style-guide
5. **Testability**: The skill can be tested and validated using the existing evaluation framework
6. **Provenance**: The skill's origins and development process are documented

## Guardrails

- Never promote a skill that has not passed sandbox validation
- Always run the full validation suite after promotion
- Document promotion decisions in provenance.md
- Do not promote skills that would break backward compatibility
- If promotion fails, provide explicit rationale for denial
- Keep the sandbox clean by removing promoted or abandoned skills