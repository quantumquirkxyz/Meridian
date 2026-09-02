# 0002 — Own minimal StateGraph as the orchestration core

Status: accepted
Date: 2026-08-13
Deciders: Jhuomar Boskoll Quintero

## Context

The system needs an orchestrator that:
- Models trading states and transitions deterministically
- Enforces guard conditions on every transition
- Supports per-agent/module permissions
- Provides mandatory audit on every state change
- Can operate without any LLM or agent framework
- Is simple enough to verify and test thoroughly

The orchestrator is the nervous system of a multi-agent trading infrastructure. If it fails, the system cannot coordinate agents, data, decisions, or actions.

## Decision

We build a **minimal in-house implementation** of a state graph (state machine + guard conditions + typed handoffs + permissions + deterministic fallbacks + per-transition audit), conceptually inspired by LangGraph but **without LangGraph as a central dependency**. The system is financially deterministic before it is agentic-conversational: the core must survive without any LLM.

## Options considered

1. **LangGraph as core dependency** — Rejected. LangGraph is designed for LLM-driven agent workflows, not deterministic financial systems. It introduces Python-style graph semantics, checkpoint persistence, and human-in-the-loop patterns that don't align with the requirement that the Risk Engine governs all execution. Coupling to LangGraph would make the core dependent on an LLM framework.

2. **Temporal for orchestration** — Rejected for the core. Temporal is excellent for durable execution and retry logic, but it's overkill for a state graph with ~20 states and deterministic transitions. The overhead of running a Temporal server doesn't justify the benefit for the current scale. May be reconsidered for the canary session if durable execution becomes necessary.

3. **XState or other state machine libraries** — Considered but rejected. These libraries provide general-purpose state machine semantics but lack the specific features needed: permission registry, guard composition, mandatory audit events, and the ability to model defensive modes that reduce activity. Building custom provides full control over the semantics.

4. **Custom minimal StateGraph** — Accepted. The implementation is ~300 lines of TypeScript. It provides: state nodes with guards, permission checks per transition, mandatory audit events, defensive mode transitions, and deterministic behavior. It's simple enough to test thoroughly and verify correctness.

## Consequences

- **Positive:** No external dependencies for the core orchestrator. The StateGraph is self-contained and verifiable.
- **Positive:** Full control over semantics — guard conditions, permission model, audit events, and defensive modes are designed specifically for trading infrastructure.
- **Positive:** The core survives without any LLM, agent framework, or external service.
- **Negative:** Maintaining a custom implementation means we own the bugs and edge cases.
- **Negative:** No built-in visualization or debugging tools (compared to LangGraph's graph viewer).
- **Follow-up:** If the state graph grows beyond ~50 states, consider extracting to a standalone library for reuse.
