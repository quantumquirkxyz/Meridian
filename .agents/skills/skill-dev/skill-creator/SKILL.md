---
name: skill-creator
category: skill-dev
maturity: stable
version: 3
description: Enhanced guide for creating effective quirk skills with structured worksheets, validation integration, and template gene
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


# Enhanced Skill Creator for quirk Skills

This skill provides a structured, worksheet-based approach to creating effective quirk skills that integrate seamlessly with the existing skills bundle, evaluation system, and validation infrastructure.

## Contract

- Input: raw skill concept, target domain, intended users
- Output: completed skill design worksheet, validated skill concept, generated skill template, validation integration plan, and documentation outline
- Scope: structured skill creation process specifically for the quirk skills ecosystem
- Rule: all generated skills must be compatible with the quirk method and validation system
- Rule: skills must follow the progressive disclosure principle and explicit contract design
- Rule: generated skills should be testable using the evaluate-skill system

## Structured Skill Creation Process

This skill guides you through creating a skill using fill-in-the-blank worksheets that ensure you address all critical aspects of skill design.

### Phase 1: Skill Conception Worksheet

Complete this worksheet to explore and validate your skill concept.

#### Worksheet 1.1: Core Concept Definition
```
Skill Name (proposed): ________________________________
One-sentence description: ________________________________________________________
________________________________________________________

What specific problem does this solve? ___________________________________________
________________________________________________________

Is this a new capability or improvement to existing? [ ] New  [ ] Improvement
If improvement, which existing skill(s) does it relate to? ________________________
________________________________________________________
```

#### Worksheet 1.2: Use Case Validation
```
List 3 concrete use cases where this skill would be valuable:
1. _________________________________________________________________
2. _________________________________________________________________
3. _________________________________________________________________

Who are the primary users/agent types that would benefit?
_________________________________________________________

What would happen if this skill didn't exist? (Describe the workaround complexity)
_________________________________________________________
_________________________________________________________

How do you know this addresses a repeatedly useful behavior?
_________________________________________________________
```

#### Worksheet 1.3: Capability Definition
```
List the specific capabilities this skill will provide (use - capability-name format):
- _________________________________________________
- _________________________________________________
- _________________________________________________

For each capability, specify:
Capability: ________________________
  Inputs required: ________________________________________
  Outputs produced: _______________________________________
  
Capability: ________________________
  Inputs required: ________________________________________
  Outputs produced: _______________________________________
```

### Phase 2: Skill Design Worksheets

#### Worksheet 2.1: Skill Contract Design
```
Description (following quirk skill-style-guide):
_________________________________________________________
_________________________________________________________
_________________________________________________________

Explicit Inputs (what the skill consumes):
- ________________________________________
- ________________________________________
- ________________________________________

Explicit Outputs (what the skill produces):
- ________________________________________
- ________________________________________
- ________________________________________

Dependencies (minimal and intentional):
- ________________________________________ (why: ____________________)
- ________________________________________ (why: ____________________)

Side Effects (honest repository modifications):
- ________________________________________
- ________________________________________

Stop Condition (clear, checkable completion criteria):
_________________________________________________________
_________________________________________________________

Risk Level (honest assessment): [ ] low  [ ] medium  [ ] high
Justification: ___________________________________________
```

#### Worksheet 2.2: Skill Body Structure Plan
```
Approach: [ ] step-based  [ ] reference-based  [ ] hybrid

What goes in SKILL.md (essential procedural instructions):
_________________________________________________________
_________________________________________________________

What goes in references/ (detailed reference material):
_________________________________________________________
_________________________________________________________

How does this skill integrate with work-item system (if relevant):
_________________________________________________________
_________________________________________________________
```

#### Worksheet 2.3: Evaluatability Design Plan
```
How will this skill be tested with evaluate-skill system?

Scenario Fixtures needed (describe expected routes):
_________________________________________________________
_________________________________________________________

Behavioral Fixtures needed (expected output formats):
_________________________________________________________
_________________________________________________________
```

### Phase 3: Skill Generation and Validation

#### Worksheet 3.1: Skill Generation
```
Follow these steps to generate your skill:
1. Create directory: .skill-sandbox/<your-skill-name>/
2. Create SKILL.md with proper YAML frontmatter from Worksheet 2.1
3. Create references/ directory and add any needed templates
4. Set up basic scripts/ and assets/ directories if needed
5. Add helpful TODO comments guiding completion

Use the templates in this skill's references/ as starting points.
```

#### Worksheet 3.2: Validation Integration
```
Create validation artifacts for your skill:

Scenario Fixtures (in .skill-sandbox/<skill-name>/scenarios/):
- [ ] Basic functionality test scenario
- [ ] Edge case scenario  
- [ ] Error condition scenario

Behavioral Fixtures (in .skill-sandbox/<skill-name>/behavioral-fixtures/):
- [ ] Expected output format for primary artifact
- [ ] Expected output format for secondary artifact (if applicable)

Run validation:
- node .skill-sandbox/validations/validate-sandbox-skills.mjs
- node .agents/skills/platform/evaluate-scenarios.mjs (when scenarios ready)
- node .agents/skills/platform/evaluate-behavioral-fixtures.mjs (when fixtures ready)
```

## Skill Template Structure

When generating a new skill using the worksheets, this structure is produced:

```
.skill-sandbox/<skill-name>/
├── SKILL.md
├── references/
│   ├── [artifact-templates-as-needed]
│   └── [example-outputs-as-needed]
├── scripts/
│   └── [helper-scripts-as-needed]
└── assets/
    └── [output-assets-as-needed]
```

## Worksheet Templates and Examples

This skill provides templates and examples to help you fill out the worksheets effectively.

### Example: Completed Worksheet 1.1 (for a hypothetical "api-versioner" skill)
```
Skill Name (proposed): api-versioner
One-sentence description: Analyzes API changes to recommend appropriate versioning strategy based on semantic versioning principles.

What specific problem does this solve? Helps developers determine when to make breaking changes vs backward-compatible changes in APIs by analyzing diffs and providing explicit versioning recommendations.

Is this a new capability or improvement to existing? [x] New  [ ] Improvement
If improvement, which existing skill(s) does it relate to? N/A
```

### Example: Completed Worksheet 2.1 (for the same skill)
```
Description (following quirk skill-style-guide):
This skill analyzes API diffs to determine appropriate versioning strategy following semantic versioning principles. Use when you need to understand the impact of API changes and get explicit guidance on version numbers.

Explicit Inputs (what the skill consumes):
- API diff or change description
- Current API version
- Documentation of breaking change guidelines

Explicit Outputs (what the skill produces):
- Recommended version number (major/minor/patch)
- List of breaking changes detected
- List of backward-compatible changes
- Versioning rationale explanation

Dependencies (minimal and intentional):
- codebase-design (why: to understand API seams and interfaces)
- domain-modeling (why: to use correct domain terminology in explanations)

Side Effects (honest repository modifications):
- write-docs (creates versioning recommendation document)

Stop Condition (clear, checkable completion criteria):
The user has received a specific version recommendation with clear rationale explaining which changes are breaking vs compatible, and understands the semantic versioning implications.

Risk Level (honest assessment): [x] low  [ ] medium  [ ] high
Justification: This skill only reads code and writes documentation - no repository modifications that could cause harm.
```

## Integration with Evaluation System

All skills created with this creator should be designed to work with the evaluate-skill system:

### Scenario Fixtures
- Create JSON scenario files that define expected routes through skills for common API versioning tasks
- Include static assertions for validating that the skill produces correct versioning recommendations
- Follow the format used in evaluate-skill/scenarios/

### Behavioral Fixtures
- Create markdown files defining expected output formats for versioning recommendations
- Include required sections (recommendation, rationale, change analysis) and forbid placeholder text
- Follow the format used in evaluate-skill/behavioral-fixtures/

## Completion Criteria

The user has completed this skill when:

- They have filled out all worksheets with specific, actionable information
- They have generated a complete skill template in the sandbox from their completed worksheets
- They have validated the skill concept using sandbox validation tools
- They have outlined how the skill integrates with the evaluation system
- They have a clear plan for iterating on the skill based on validation feedback

## Guardrails

- Always validate skill concepts against existing skills to prevent duplication
- Design skills to be minimal and focused - prefer creating multiple small skills over one large one
- Ensure skills can be tested in isolation using the sandbox environment
- Follow the quirk method principles rigorously in skill design
- Consider how the skill fits into larger workflows before creating it
- Remember that predictability is the root virtue - design for consistent behavior
- Use the worksheets to ensure explicit, checkable decisions at each step