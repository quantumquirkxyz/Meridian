# 0003 — No AI agent executes orders; deterministic engines govern

Architectural invariant: **no AI agent executes orders, approves risk, or moves funds**. Agents produce typed observations, hypotheses, and recommendations. Authority is deterministic: the Risk Engine (approves/rejects/reduces every OrderIntent), the Execution Engine (the only component that sends orders), the Reconciliation Engine, Circuit Breakers, and the Kill Switch.

Mandatory flow: data → graph → candidate signal → agent review → Risk Engine → OrderIntent → Execution Engine → Reconciliation → Audit. Nothing may skip the Risk Engine. If the system cannot audit, it does not trade.
