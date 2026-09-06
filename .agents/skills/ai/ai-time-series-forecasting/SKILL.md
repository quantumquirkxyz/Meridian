---
name: ai-time-series-forecasting
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design and evaluate time-series forecasting — ARIMA, Prophet, NeuralProphet, LSTM, Transformer — with stationarity analysis, seasonality, exogenous variables, and backtest.
capabilities:
  - analyse stationarity (ADF, KPSS) and seasonality (decomposition, autocorrelation)
  - select model family (classical / boosted / deep learning / ensemble)
  - build forecast pipeline respecting time-order split
  - evaluate with time-series metrics (MAPE, sMAPE, MASE, RMSE) and rolling backtest
outputs:
  - Forecast plot with prediction intervals
  - Model comparison table (metrics per model)
  - Backtest report with holdout validation
sideEffects: []
dependencies: []
stopCondition: Forecast plot saved; backtest complete; best model recommendation made.
risk: medium
trustTier: 3
maxIterations: 6
---

## Contract

- **Input:** time-series data (date + target; optional exogenous variables).
- **Output:** forecast plot + comparison + recommendation.
- **Side effects:** none.
- **Dependencies:** time-series data source.
- **Stop condition:** backtest complete; recommendation made.
- **Risk:** medium — forecast affects planning; requires validation.
- **Boundary:** designs forecasting pipeline; does not make business decisions.

# Time-Series Forecasting

Build a **time-series forecast** — with stationarity analysis, seasonality, exogenous variables, and backtest — and recommend the best model.

## Process

### 1. Data inspection
Plot series; check for missing values, outliers, structural breaks. Check stationarity: ADF test, KPSS test. Decompose: trend + seasonal + residual.

**Completion criterion:** stationarity state stated; seasonality identified.

### 2. Feature engineering
Lag features (autoregressive terms); rolling statistics; exogenous variables (available at forecast time); categorical time features.

**Completion criterion:** feature set documented; no leakage.

### 3. Model selection
Classical (ARIMA / SARIMA / Prophet), gradient-boosted (XGBoost / LightGBM), deep learning (LSTM / Transformer / N-BEATS), or ensemble. Select by backtest performance, not training error.

**Completion criterion:** model family selected with justification.

### 4. Backtest
Rolling / expanding window; respect time order; evaluate MAPE, sMAPE, MASE, RMSE, MAE.

**Completion criterion:** backtest complete; metrics on holdout.

### 5. Prediction intervals
Provide 80% / 95% intervals — not just point forecasts.

**Completion criterion:** intervals in plot.

### 6. Recommendation
Best model with evidence; limitations (exogenous availability, structural breaks, seasonality change); re-training frequency.

**Completion criterion:** recommendation with conditions.
