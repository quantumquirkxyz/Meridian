---
name: prod-prd-writing
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Write Product Requirement Documents (PRDs) — problem statement, goals, user stories, acceptance criteria, success metrics, timeline — with stakeholder alignment.
capabilities:
  - frame problem and user need
  - write measurable goals and success metrics
  - structure user stories with acceptance criteria
  - define timeline, dependencies, and risks
outputs:
  - PRD document (Markdown / Notion / Google Docs)
  - User story mapping
  - Success metrics table (leading / lagging)
sideEffects: []
dependencies: []
stopCondition: PRD saved; stakeholder alignment noted; metrics defined.
risk: low
trustTier: 1
maxIterations: 5
---

## Contract

- **Input:** product idea, user feedback, business problem, stakeholder input.
- **Output:** PRD with problem, goals, user stories, acceptance criteria, metrics, timeline.
- **Side effects:** none (design only; does not build product).
- **Dependencies:** stakeholder input (optional).
- **Stop condition:** PRD saved; metrics and timeline defined.
- **Risk:** low.
- **Boundary:** writes PRD; does not make product decisions unilaterally.

# Product Requirements Document

Turn a **product idea** into a structured PRD with aligned goals, measurable outcomes, and clear scope.

## Process

### 1. Problem statement
- What problem does this solve for users?
- Who is affected? (user segment)
- How is it solved today? (workaround, competitor, manual process)
- What is the cost of not solving?

**Completion criterion:** problem clear; user segment defined.

### 2. Goals
- **Business goal:** revenue, retention, efficiency, market position.
- **User goal:** task completed faster / easier / with less error.
- **Technical goal:** system reliability, performance, maintainability.
- **Measurable:** each goal has a metric and target.

**Completion criterion:** goals with metrics saved.

### 3. User stories
For each user journey: "As a [user type], I want [action] so that [benefit]."
- Acceptance criteria per story: given / when / then; conditions for pass.
- Priority: must-have / should-have / nice-to-have.

**Completion criterion:** stories with acceptance criteria saved.

### 4. Success metrics
- **Leading** (predictive): feature adoption rate, time-to-first-value, error rate.
- **Lagging** (outcome): revenue impact, retention, NPS, customer satisfaction.
- **Dashboard:** how will metrics be tracked (analytics tool, telemetry, survey)?

**Completion criterion:** metrics table saved.

### 5. Constraints and risks
- Technical: dependencies, performance, security.
- Regulatory: compliance (GDPR, accessibility, financial regulations).
- Timeline: dependencies, holidays, team availability.
- Risk mitigation per item.

**Completion criterion:** risks with mitigation saved.

### 6. Timeline and milestone
- Milestones with dates and deliverables.
- Dependencies between milestones.
- Review points (design review, user testing, release readiness).

**Completion criterion:** timeline saved with milestones.
