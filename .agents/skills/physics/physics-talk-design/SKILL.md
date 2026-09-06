---
name: physics-talk-design
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design physics talks — seminars, conference presentations, posters, public outreach — with audience-level adjustments, timing, visual conventions, and accessibility.
capabilities:
  - design talk structure (introduction, result, conclusion) for audience and duration
  - prepare figures consistent with physics conventions (units, error bars, axis labels)
  - design posters (layout, colour, font, figure arrangement) for conferences
  - prepare speaker notes with timing cues
outputs:
  - Beamer / PowerPoint / Keynote source
  - Poster PDF (A0 / A1 / conference size)
  - Speaker notes (Markdown or slide annotations)
  - Accessibility checklist (colour, font, alt text)
sideEffects: []
dependencies: []
stopCondition: Source compiled; notes saved; checklist completed.
risk: low
trustTier: 1
maxIterations: 5
---

## Contract

- **Input:** talk/poster topic, audience, duration / size.
- **Output:** source + notes + checklist.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** compiled; checklist complete.
- **Risk:** low.
- **Boundary:** prepares talk/poster; does not deliver it.

# Physics Talk Design

Build a **physics talk or poster** — seminar, conference talk, public outreach — with audience-appropriate depth and visual conventions.

## When to use

- A seminar or conference talk needs slides.
- A poster needs layout, figure arrangement, and colour rules.
- A public talk needs a reduced-depth version.

## Process

### 1. Audience and duration

- **Audience:** specialist / cross-disciplinary / student / public.
- **Duration:** 15 min / 30 min / 50 min / 90 min.
- **Format:** talk / poster / panel / public lecture.

**Completion criterion:** audience and format explicit.

### 2. Structure

Standard talk structure:

- **Hook:** why should this audience care? (1 minute).
- **Context:** what is known; what is missing. (2 minutes).
- **Method / model:** the approach (technical for specialists; conceptual for students). (3–5 minutes).
- **Result:** clear statement with figure. (3–5 minutes).
- **Interpretation:** what does this mean? (2 minutes).
- **Conclusion / take-away:** one sentence. (1 minute).

**Completion criterion:** structure saved; timing targets set.

### 3. Figures and conventions

Physics conventions:

- **Units:** always on axes (e.g. "Energy (eV)").
- **Error bars:** visible and labelled (statistical, systematic).
- **Colour:** distinguishable in grayscale; use pattern or line style for colour-blind readers.
- **Scale:** logarithmic / linear stated; avoid misleading truncation.
- **Reference lines:** dashed for theoretical predictions; solid for data.

**Completion criterion:** all figures comply with conventions; accessibility checklist filled.

### 4. Poster design

- **Layout:** title, abstract, result figure, conclusion, references.
- **Flow:** top-to-bottom, left-to-right; highlight result in centre.
- **Font size:** readable from 1.5 m (min 18pt for body, 36pt for headings).
- **Colour:** consistent theme; avoid red-green only combinations.
- **QR code:** link to paper / data / arXiv.

**Completion criterion:** poster layout saved; readability checked.

### 5. Speaker notes and timing

- **Notes:** key message per slide; common question and answer.
- **Timing:** practice aloud; adjust slides to meet duration.
- **Transitions:** state what the next slide answers.

**Completion criterion:** notes saved for each slide; practice timing recorded.
