---
name: math-computation-reproducible
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Make mathematical computations reproducible — SymPy, Mathematica, Magma, Sage, Julia — with versioned environments (Docker/Conda/Nix), scripts, and result archival.
capabilities:
  - capture a computation in a script (SymPy / Mathematica / Magma / Sage / Julia)
  - pin the environment (library versions, OS, RNG seeds)
  - containerise with Docker / Apptainer / Nix
  - archive inputs, scripts, outputs, and environment
outputs:
  - Versioned source script
  - Container definition (Dockerfile or Nix expr)
  - Manifest with environment versions, seeds, and result hashes
  - Markdown report linking all artifacts
sideEffects: []
dependencies: []
stopCondition: All artifacts saved; container builds; result reproducible from artifacts alone.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** mathematical computation (symbolic / numeric) and target CAS.
- **Output:** versioned script + container + manifest.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** container builds; manifest complete.
- **Risk:** low.
- **Boundary:** produces reproducible artifacts; no system-wide install beyond declared environment.

# Reproducible Math Computation

Run a **mathematical computation** that another researcher can rerun bit-for-bit — same inputs, same library versions, same outputs — and ship the artifacts.

## When to use

- A paper's result depends on a non-trivial computation.
- A computational number (e.g. counterexample, zeta value) needs to be cited.
- A reviewer wants to verify the calculation.

## Process

### 1. Pick the tool

- **SymPy / SymEngine** — symbolic, Python, free.
- **Mathematica** — broad coverage; commercial.
- **Magma** — number theory, algebra, finite groups.
- **SageMath** — open umbrella; bridges many libraries.
- **Julia (Nemo, Hecke, AbstractAlgebra)** — performance + algebra.

State the choice; pin version.

**Completion criterion:** tool and version fixed.

### 2. Script the computation

- One script per question (not a notebook cell dump).
- Inputs declared at the top.
- Random seeds explicit.
- Outputs written to files with content-hash filenames.

**Completion criterion:** script runs end-to-end from a clean checkout.

### 3. Pin the environment

- **Python:** `requirements.txt` with hashes, or `pixi.lock` / `uv.lock`.
- **Conda:** `environment.yml` with channel + version.
- **Mathematica:** `$Version` and `$SystemID` recorded.
- **Magma:** release version + OS.
- **OS:** declare base image (Ubuntu 22.04, etc.).

**Completion criterion:** env manifest saved with exact versions.

### 4. Containerise

- **Docker:** minimal image with the tool + dependencies.
- **Apptainer (Singularity):** for HPC clusters.
- **Nix:** for reproducible Linux builds.

The container must run the script and produce the declared outputs.

**Completion criterion:** container builds; produces identical outputs on a fresh host.

### 5. Archive and document

- Push code to a versioned repo (Git tag the result).
- Upload inputs / outputs to Zenodo with a DOI.
- Markdown report links: code repo, container image, Zenodo bundle, paper section.

**Completion criterion:** all artifacts reachable via DOI or Git tag.

## Notes

- Pair with `cs-formal-methods` for verification and `scientific-reproducibility` for broader framing.
- A reproducible computation earns a footnote in the paper.
