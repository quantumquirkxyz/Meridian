---
name: ai-ml-pipeline
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design ML pipelines — data ingestion, preprocessing, training, evaluation, deployment, monitoring — with reproducibility, fairness, and version control.
capabilities:
  - design data ingestion and preprocessing pipelines
  - select model architecture, training regimen, evaluation metrics
  - implement reproducible training with versioned data and code
  - deploy to staging/production with monitoring
outputs:
  - Pipeline architecture diagram (text/Markdown)
  - Training report (metrics, curves, validation results)
  - Deployment checklist (model registry, container, monitoring rules)
sideEffects: []
dependencies: []
stopCondition: Pipeline architecture saved; training report complete; deployment checklist filled.
risk: medium
trustTier: 3
maxIterations: 8
---

## Contract

- **Input:** dataset description, problem type, performance target.
- **Output:** pipeline architecture + training report + deployment checklist.
- **Side effects:** may create artifacts (models, logs) when executed.
- **Dependencies:** external ML framework (scikit-learn, PyTorch, TensorFlow, XGBoost) and data source.
- **Stop condition:** pipeline documented; model validated; checklist filled.
- **Risk:** medium — model decisions affect users; requires validation.
- **Boundary:** designs pipeline; does not train production models unless explicitly executed.

# ML Pipeline Design

Build a **machine-learning pipeline** from data to deployed model with reproducibility and fairness checks.

## Process

### 1. Frame the problem
State: supervised / unsupervised / reinforcement; classification / regression / clustering; time-series / tabular / image / text / tabular-time-series.

**Completion criterion:** problem type named; target metric defined.

### 2. Data design
- Source (database, API, file store, synthetic).
- Schema (features, target, weights, time stamps).
- Preprocessing (imputation, encoding, scaling, feature engineering, augmentation).
- Train / validation / test split; stratification if needed.

**Completion criterion:** data schema and split strategy documented.

### 3. Model selection
- Baseline (simple: logistic regression, linear, random forest, XGBoost).
- Advanced (deep learning, transformers, ensembles).
- Selection criteria: interpretability vs performance vs resource cost.

**Completion criterion:** model family selected with justification.

### 4. Training design
- Loss function; optimiser; learning rate schedule.
- Cross-validation strategy (k-fold, time-series split, stratified).
- Regularisation (L2, dropout, early stopping, data augmentation).
- Reproducibility: seed, versioned library, container.

**Completion criterion:** training plan documented with seeds and versions.

### 5. Evaluation
- Metrics aligned with business goal (accuracy / F1 / ROC-AUC / MAE / RMSE / log-loss / lift / ranking metrics).
- Validation vs test distinction; no lookahead.
- Error analysis (confusion matrix, worst-case examples, subgroup differences / fairness audit).

**Completion criterion:** evaluation report with subgroup fairness check.

### 6. Deployment and monitoring
- Model registry (MLflow, DVC, Weights & Biases).
- Container (Docker / Kubernetes) with pinned versions.
- Monitoring: drift (data / concept / performance), latency, error rate.
- Rollback plan.

**Completion criterion:** deployment checklist complete; monitoring rules defined.
