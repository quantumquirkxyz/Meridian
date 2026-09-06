---
name: prod-okr-planning
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design OKR cycles — Objectives, Key Results, initiatives — with measurable outcomes, quarterly cadences, and team alignment.
capabilities:
  - define Objectives that are ambitious and qualitative
  - define Key Results that are measurable and time-bound
  - align team OKRs to company and department OKRs
  - track progress and run retrospectives at end of cycle
outputs:
  - OKR document (quarterly cycle with Objectives and Key Results)
  - Initiative list linked to KRs
  - Progress tracker template
sideEffects: []
dependencies: []
stopCondition: OKR document saved; initiatives mapped to KRs; progress tracker template ready.
risk: low
trustTier: 1
maxIterations: 4
---

## Contract

- **Input:** team mission, company OKRs, current quarter / cycle.
- **Output:** team OKR document + initiative mapping.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** OKR document saved; KRs measurable; initiatives mapped.
- **Risk:** low.
- **Boundary:** designs OKRs; does not execute initiatives.

# OKR Planning

Design a **quarterly OKR cycle** — Objectives, Key Results, initiatives — with measurable outcomes and team alignment.

## Process

### 1. Mission alignment
- State the team mission for the quarter.
- Align with company OKRs (copy relevant ones; ignore if not applicable).
- Identify what the team uniquely contributes that no other team can.

**Completion criterion:** mission statement saved.

### 2. Objectives
Rules for a good Objective:
- Ambitious and inspiring (motivates the team).
- Qualitative (not a number).
- Time-bound (one quarter).
- 2–4 Objectives per team per quarter.

**Completion criterion:** 2–4 Objectives saved.

### 3. Key Results
Rules for good Key Results:
- Measurable (has a number and baseline).
- Outcome-oriented (not output — not "we will build X" but "X will improve Y by Z%").
- Achievable (70% success is good — overconfident KRs demoralise teams).
- Relevant (directly supports the Objective).
- Time-bound (achievable within the quarter).

For each Objective: 2–4 Key Results.

**Completion criterion:** KRs saved with baseline and target.

### 4. Initiatives
For each KR: list the initiatives (projects, tasks, experiments) that drive it.
Not every initiative maps to a KR — if an initiative has no KR, question whether it belongs.

**Completion criterion:** initiatives mapped to KRs.

### 5. Progress tracking
Define: how often (weekly / biweekly), who updates, what format (score 0–1.0 per KR), and what to do when off-track (adjust, escalate, drop).

**Completion criterion:** tracker template saved.

### 6. Retro
At end of cycle: score each KR (0.0–1.0); write retrospective: what worked, what didn't, what to carry forward.

**Completion criterion:** retro template saved.
