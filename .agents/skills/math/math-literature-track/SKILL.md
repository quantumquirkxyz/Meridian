---
name: math-literature-track
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Track mathematics literature across arXiv, MathSciNet, zbMATH, journal alerts, and citation graphs to keep a researcher current without drowning in papers.
capabilities:
  - monitor arXiv categories (math.AG, math.NT, math.AP, math.PR, math.CO, math.OC) and filter by author/keyword
  - pull MathSciNet / zbMATH metadata and citation graph
  - build a personal digest of new papers with relevance ranking
  - track references, forward citations, and reviews of a given theorem/paper
outputs:
  - Markdown digest (weekly / monthly) with grouped papers, abstracts, citations, and a relevance verdict
  - optional CSV / BibTeX of new entries
sideEffects: []
dependencies: []
stopCondition: digest artifact saved with grouped papers and relevance scores; all sources cited.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** researcher's keywords, authors, categories, and time window.
- **Output:** Markdown digest and optional BibTeX/CSV.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** digest saved with grouped papers, citations, and relevance notes.
- **Risk:** low.
- **Boundary:** reads and summarises; no new mathematical claims.

# Math Literature Tracking

Track the **front of mathematics** that matters to the researcher, with explicit sources and a personal relevance signal.

## Process

### 1. Define the tracking set

State:

- **Categories** — arXiv (e.g. math.AG + math.NT + math.PR).
- **Authors** — names to follow.
- **Keywords** — title / abstract terms (e.g. "Galois representation", "Lyapunov exponent").
- **Window** — since last digest (default 7 days).
- **Citation triggers** — when a paper cites an old paper of interest.

**Completion criterion:** set is explicit; queries reproducible.

### 2. Pull from primary sources

- **arXiv:** `arxiv` API / RSS by category, then filter.
- **MathSciNet / zbMATH:** metadata, reviews, MSC codes.
- **Crossref / DOI:** journal versions.
- **Semantic Scholar / OpenAlex:** citation graph.

Each item carries: title, authors, abstract, source, link, MSC codes, citation count.

**Completion criterion:** each item sourced; missing data flagged.

### 3. Score relevance

For each paper, score 1–5:

- **5:** by a tracked author, in a tracked category, matches a tracked keyword.
- **4:** close match (one of three).
- **3:** neighbouring field; possibly useful.
- **2:** tangentially related.
- **1:** not relevant.

State the score reason in one sentence.

**Completion criterion:** every paper scored; reason stated.

### 4. Group

Group by:

- **By topic** (cluster of papers on the same question).
- **By author** (output of a followed researcher).
- **By method** (which technique family).
- **By milestone** (e.g. "extends Theorem X", "refutes Conjecture Y").

**Completion criterion:** groupings explicit; at least two perspectives.

### 5. Deliver the digest

Markdown artifact with: header (window), groups, scored items, follow-ups (papers to read deeply), citations, and **suggested reading order** (most relevant first).

**Completion criterion:** digest saved; reading order stated.

## Notes

- This is **monitoring**, not **review** — for deep analysis use `research` or `scientific-literature-review`.
- Maintain a persistent `digest/` folder indexed by date.
