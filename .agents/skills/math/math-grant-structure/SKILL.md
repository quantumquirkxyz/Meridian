---
name: math-grant-structure
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Structure mathematics grant proposals (NSF, ERC, Simons, MSCA) — aims, broader impacts, budget, timeline, reviewer expectations — with concrete templates.
capabilities:
  - align proposal with agency call (NSF / ERC / Simons / MSCA / NSERC)
  - articulate intellectual merit and broader impacts (or equivalents)
  - structure aims, work plan, deliverables, timeline
  - draft budget justifications and data-management plans
outputs:
  - Markdown outline + per-section draft
  - Reviewer-perspective critique
  - Submission checklist
sideEffects: []
dependencies: []
stopCondition: All sections drafted; reviewer-perspective critique complete; submission checklist filled.
risk: low
trustTier: 1
maxIterations: 5
---

## Contract

- **Input:** research programme + target agency.
- **Output:** structured proposal draft + reviewer critique.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** draft + critique + checklist.
- **Risk:** low.
- **Boundary:** produces draft text; the human submits.

# Math Grant Proposal Structuring

Turn a **research programme** into a grant proposal that matches the agency's review criteria — and stress-test it from the reviewer's chair.

## When to use

- The user is preparing an NSF / ERC / Simons / MSCA / NSERC application.
- A research group needs a multi-PI budget narrative.
- An early-career researcher is drafting a starter grant.

## Process

### 1. Read the call

Extract:

- **Award type** — individual, collaborative, postdoc, equipment.
- **Review criteria** — intellectual merit / broader impacts (NSF), excellence / impact (ERC), etc.
- **Page limits** — exact numbers per section.
- **Required attachments** — biosketch, DMP, budget justification, letters.
- **Deadlines** — internal + external.

**Completion criterion:** requirements checklist saved.

### 2. Articulate the programme

- **Central question** in one sentence.
- **Why now** — what changed (new theorem, new technique, new data).
- **Aims** — 3–5 specific, measurable aims.
- **Approach** — methods, expected obstacles, alternatives.

**Completion criterion:** programme stated concretely; aims measurable.

### 3. Map to criteria

For each aim, state:

- How it advances **intellectual merit** (or equivalent).
- How it advances **broader impacts** (or equivalent).
- What **deliverables** (preprints, talks, software, mentoring) result.

**Completion criterion:** each aim maps to a criterion explicitly.

### 4. Budget and timeline

- **Personnel** — PI, postdocs, grad students; named or TBD.
- **Travel** — conferences, collaboration visits.
- **Equipment** — compute, software licences.
- **Indirect costs** — per agency rules.
- **Timeline** — Gantt-style milestones per year.

**Completion criterion:** budget matches agency categories; timeline realistic.

### 5. Reviewer-perspective critique

Write the critique as if reviewing:

- **Strengths** — what makes the proposal stand out; which aims are most credible; which broader impacts are most concrete.
- **Weaknesses** — where the logic is thin; which budget items are under-justified; where the timeline is unrealistic.
- **Questions** — what the reviewer would ask; write answers in advance.
- **Verdict** — recommend approve / revise / decline, with explicit conditions.

**Completion criterion:** critique written with strengths, weaknesses, questions, verdict.

### 6. Submission checklist

- [ ] All required sections present and within page limits.
- [ ] Biosketch / CV updated and formatted.
- [ ] Budget justification matches budget table.
- [ ] Data-management plan saved.
- [ ] References complete (no missing citations).
- [ ] All co-PIs have confirmed contribution.
- [ ] Letters of collaboration / support saved.
- [ ] Proposal compiled to PDF with correct margins and fonts.
- [ ] Submitted by deadline; confirmation saved.

**Completion criterion:** all boxes checked; checklist saved.

### 7. Deliver

Markdown artifact with: call analysis, programme, aims mapping, budget, timeline, reviewer critique (strengths/weaknesses/questions/verdict), submission checklist.

**Completion criterion:** deliverable complete and reviewed by at least one co-author or mentor before submission.