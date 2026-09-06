---
name: physics-reproducibility-archive
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Make physics research reproducible and archive it — Zenodo DOI, GitHub + container (Docker/Apptainer), data preservation, code review, and open-science compliance for journals and funders.
capabilities:
  - prepare data, code, and environments for archival
  - containerise (Docker / Apptainer) with exact versions and dependencies
  - upload to Zenodo with metadata (title, authors, licence, keywords)
  - prepare supplemental material for journal submission
outputs:
  - Zenodo DOI badge and URL
  - GitHub release / tag with container image hash
  - Archive checklist (data, code, environment, license)
sideEffects: []
dependencies: []
stopCondition: Zenodo DOI assigned; GitHub tag created; checklist complete.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** physics result, data, and code.
- **Output:** Zenodo DOI + GitHub release + checklist.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** DOI assigned; tag created; checklist complete.
- **Risk:** low.
- **Boundary:** archives and links; does not execute long computations.

# Physics Reproducibility and Archival

Make a **physics result** reproducible and archive it with a DOI — data, code, and environment — for compliance with journals and funders.

## When to use

- A paper is being submitted to a journal that requires data availability.
- A funder (DOE, NSF, ERC) requires open data / code.
- A reviewer or collaborator needs to reproduce a result.

## Process

### 1. Inventory the artifacts

List:

- **Raw data** — unprocessed files from the experiment / simulation.
- **Processed data** — calibrated and cleaned.
- **Analysis code** — scripts that produce figures and tables.
- **Simulation code** — input parameters, source, build instructions.
- **Environment** — library versions, OS, compilers.
- **Figures and tables** — with captions that cite the source data.

**Completion criterion:** inventory saved as `REPRODUCIBILITY.md`.

### 2. Prepare for archival

- **Data:** clean, documented schema; remove PII; check file formats (open preferred: CSV, HDF5, FITS; avoid proprietary).
- **Code:** add README, `setup.py` / `pyproject.toml`, test that it runs.
- **Documentation:** usage instructions, expected output, hardware requirements.
- **Licence:** MIT, Apache 2.0, or CC0 for data; GPL for code (choose before upload).

**Completion criterion:** inventory items prepared; licence chosen.

### 3. Containerise

- **Docker:** `Dockerfile` with base image, tool versions, code, data.
- **Apptainer:** `.def` file for HPC clusters.
- Include: exact tool versions (not `latest`); build instructions; run command.

**Completion criterion:** container builds; produces expected output on a fresh host.

### 4. Archive on Zenodo

Create a Zenodo deposit:

- **Title:** descriptive and unique (not just "Data for paper").
- **Authors:** all contributors, with ORCIDs.
- **Keywords:** physics terms (e.g. "quantum optics", "cosmology", "plasma physics").
- **Licence:** stated.
- **Related identifiers:** link to the paper (arXiv DOI or journal DOI).
- **Upload:** data + code + container (or link to Docker Hub / GHCR).

**Completion criterion:** Zenodo record created; DOI assigned.

### 5. GitHub release

- Tag the repository with the paper version (e.g. `v1.0`).
- Write a release note: what changed, what is archived.
- Link to the Zenodo DOI in the release.

**Completion criterion:** GitHub release created; DOI linked.

### 6. Checklist and compliance

- **Journal requirements** — which journals require data / code? (Nature, Science, APS, IOP all have policies).
- **Funder requirements** — NSF, DOE, ERC open-data mandates.
- **FAIR compliance** — check Findable, Accessible, Interoperable, Reusable.
- **Supplemental material** — prepare for journal submission (separate from archival).

**Completion criterion:** checklist saved; compliance status per requirement.

## Notes

- Pair with `physics-simulation-setup` for simulation containerization.
- Pair with `physics-experimental-notebook` for experimental data archival.
- Pair with `physics-writing-revtex` for journal submission.
