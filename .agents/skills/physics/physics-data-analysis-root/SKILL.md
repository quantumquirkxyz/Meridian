---
name: physics-data-analysis-root
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Analyse experimental physics data with ROOT, pandas, uproot, NumPy — calibration, systematic errors, statistical inference, result archival — with reproducible scripts.
capabilities:
  - load experimental data (ROOT / HDF5 / CSV / binary) with schema validation
  - apply calibration corrections (energy scale, efficiency, acceptance)
  - propagate statistical and systematic errors (covariance matrix or bootstrap)
  - perform statistical inference (fit, hypothesis test, confidence interval)
outputs:
  - Python / ROOT script (reproducible)
  - Analysis report (Markdown) with results, plots, error budgets, systematic table
sideEffects: []
dependencies: []
stopCondition: Script runs; report saved with error budget, systematic table, and plot links.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** experimental data file(s), calibration constants, analysis goal.
- **Output:** analysis script + report.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** script runs; report complete.
- **Risk:** low.
- **Boundary:** analyses data; does not change raw files.

# Physics Data Analysis — ROOT / Python

Analyse **experimental physics data** with reproducible scripts, explicit calibration, and a complete error budget.

## When to use

- Experimental data needs statistical analysis.
- A result needs a systematic error table.
- Data must be preserved with analysis linked.

## Process

### 1. Data loading and validation

- Load data (ROOT / HDF5 / CSV / binary); verify schema.
- Check for missing values, outliers, inconsistent units.
- Confirm file provenance (run number, detector state, date).

**Completion criterion:** data validated; provenance recorded.

### 2. Calibration

Apply:

- **Energy / momentum scale** — calibration from standard source.
- **Efficiency correction** — acceptance and reconstruction efficiency.
- **Background subtraction** — with statistical error.

Record the calibration constants with their uncertainties.

**Completion criterion:** calibration applied; constants with errors saved.

### 3. Statistical analysis

- **Histogram / fit** — with appropriate model (Gaussian, Poisson, exponential, custom).
- **Hypothesis test** — chi² / Kolmogorov-Smirnov / likelihood ratio.
- **Confidence interval** — 68% / 95% (bootstrap or analytic).
- **Systematic table** — each source (calibration, model, background, acceptance) with contribution.

**Completion criterion:** statistical result with error budget saved; systematic table present.

### 4. Results and plots

- **Plots:** data points + model / fit; systematic bands; labels with units.
- **Result summary:** value ± statistical ± systematic.
- **Reproducibility:** script saved; data file linked by DOI or path.

**Completion criterion:** plots saved; result summary present; script linked.
