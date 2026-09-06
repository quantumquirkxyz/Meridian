# 0003 — No AI agent executes orders; deterministic engines govern

Status: accepted
Date: 2026-08-13
Deciders: Jhuomar Boskoll Quintero

## Context

The system uses AI agents for cognitive tasks: market analysis, regime classification, opportunity debate, risk narration, memory recall. However, the crypto trading domain has catastrophic failure modes: a single misplaced order can lose capital, a duplicated order can double exposure, and an unapproved execution can bypass risk limits.

The fundamental question is: should AI agents have execution authority, or should they be advisory only?

## Decision

Architectural invariant: **no AI agent executes orders, approves risk, or moves funds**. Agents produce typed observations, hypotheses, and recommendations. Authority is deterministic: the Risk Engine (approves/rejects/reduces every OrderIntent), the Execution Engine (the only component that sends orders), the Reconciliation Engine, Circuit Breakers, and the Kill Switch.

Mandatory flow: data → graph → candidate → agent review → Risk Engine → OrderIntent → Execution Engine → Reconciliation → Audit. Nothing may skip the Risk Engine. If the system cannot audit, it does not trade.

## Options considered

1. **Agents with execution authority** — Rejected. LLM outputs are non-deterministic. The same prompt can produce different orders at different times. In a domain where execution errors have financial consequences, non-deterministic execution is unacceptable. An agent that "hallucinates" an order quantity or forgets a risk limit can cause catastrophic loss.

2. **Agents with conditional execution** — Rejected. "Agents can execute if risk checks pass" sounds reasonable but creates a dangerous attack surface: an agent could craft an OrderIntent that passes risk checks but doesn't match the agent's actual analysis. The separation must be absolute, not conditional.

3. **Agents as advisory only** — Accepted. Agents observe, analyze, debate, and recommend. The Risk Engine evaluates every OrderIntent independently. An agent's recommendation is a signal, not an order. The Risk Engine may approve, reject, reduce, or halt based on its own deterministic evaluation. This creates a clean separation: agents can be wrong (and the system still works), but the Risk Engine cannot be bypassed.

## Consequences

- **Positive:** The system is safe against LLM hallucination, prompt injection, and agent misbehavior. No agent can cause financial loss directly.
- **Positive:** Agents can be upgraded, replaced, or disabled without affecting the execution path. The Risk Engine doesn't care which agent proposed an order.
- **Positive:** The permission model is enforceable at compile time. Agents never receive `APPROVE_RISK`, `SUBMIT_ORDER`, `SIGN_TRANSACTION`, `MOVE_FUNDS`, or `MODIFY_RISK_LIMITS` permissions.
- **Negative:** The system cannot react faster than the Risk Engine allows. If the Risk Engine is slow, execution is delayed. This is an acceptable tradeoff for safety.
- **Negative:** Agent analysis that disagrees with the Risk Engine's decision is discarded. This may feel wasteful but is necessary for deterministic safety.
- **Follow-up:** Monitor whether the Risk Engine's evaluation latency becomes a bottleneck. If so, optimize the Risk Engine, not relax the separation.
