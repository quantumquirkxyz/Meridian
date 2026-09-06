---
name: ai-model-evaluation
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Evaluate ML / LLM models — accuracy, fairness, robustness, explainability, drift — with explicit metrics, subgroup analysis, and failure-mode reporting.
capabilities:
  - compute standard metrics (precision, recall, F1, ROC-AUC, MAE, RMSE, MAPE, log-loss)
  - analyse fairness across subgroups (demographic parity, equalised odds, calibration)
  - test robustness (adversarial examples, noise, distribution shift)
  - generate explainability (feature importance, SHAP, LIME, counterfactuals)
outputs:
  - Evaluation report (metrics, subgroup tables, robustness tests, explainability notes)
  - Failure-mode analysis (confusion matrix, worst cases, out-of-distribution detection)
  - Recommendation (deploy / revise / do not deploy)
sideEffects: []
dependencies: []
stopCondition: Report saved; subgroup analysis complete; failure modes documented; recommendation made.
risk: medium
trustTier: 3
maxIterations: 6
---

## Contract

- **Input:** model predictions, ground truth, subgroup labels, feature data.
- **Output:** evaluation report with recommendation.
- **Side effects:** none (analysis only; does not deploy).
- **Dependencies:** model artifacts, test set, subgroup metadata.
- **Stop condition:** report complete with subgroup analysis.
- **Risk:** medium — recommendations affect deployment; requires validation.
- **Boundary:** evaluates; does not deploy.

# Model Evaluation

Evaluate a **machine-learning or LLM model** with metrics, subgroup fairness, robustness, and explainability — and recommend deployment or revision.

## Process

### 1. Define metrics
Select metrics aligned with the problem:
- Classification: accuracy, precision, recall, F1, ROC-AUC, PR-AUC, log-loss, Cohen's kappa.
- Regression: MAE, RMSE, MAPE, R², explained variance.
- Ranking / recommendation: NDCG, MAP, hit-rate, lift.
- LLM: BLEU, ROUGE, BERTScore (not just human preference).

**Completion criterion:** metrics named; justification stated.

### 2. Subgroup / fairness analysis
Split predictions by subgroup: gender, age, race, region, income, language.
Compute:
- Demographic parity (P(pred=1 | group))
- Equalised odds (TPR/FPR equality)
- Calibration (predicted probability matches observed rate)
- Performance gap (F1 difference between groups)

Report the largest gap and whether it exceeds an acceptable threshold.

**Completion criterion:** subgroup tables saved; largest gap reported.

### 3. Robustness
Test under perturbation:
- Adversarial examples (FGSM, PGD for images; word substitution for text).
- Noise (Gaussian, dropout, label noise).
- Distribution shift (test on a different domain / time period).

**Completion criterion:** robustness results with failure examples.

### 4. Explainability
- Feature importance (SHAP, permutation, mutual information).
- Counterfactual: what minimal change flips the prediction?
- Attention maps / saliency (for vision / NLP).

**Completion criterion:** explanation method applied to worst-case examples.

### 5. Failure-mode analysis
From confusion matrix or error set:
- Which cases are wrong? (false positives, false negatives, outliers)
- Is the error systematic (bias) or random?
- What does the failure reveal about model limits?

**Completion criterion:** failure-mode section with examples.

### 6. Recommendation
- Deploy if: metrics exceed thresholds; fairness gaps below threshold; robustness acceptable; failure modes understood and mitigated.
- Revise if: weak on one dimension but fixable.
- Do not deploy if: large fairness gap; brittle to shift; failure modes dangerous.

**Completion criterion:** recommendation with explicit conditions.
