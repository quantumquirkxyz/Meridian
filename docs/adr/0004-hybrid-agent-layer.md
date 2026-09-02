# 0004 — Hybrid agent layer: OpenRouter via Vercel AI SDK + behavioral runtimes behind AgentAdapter

Status: accepted
Date: 2026-08-15 (updated 2026-09-01)
Deciders: Jhuomar Boskoll Quintero

## Context

The system needs a cognitive layer for agent reasoning (regime classification, opportunity debate, risk narration, memory recall, audit scoring) but must never couple the deterministic core to an LLM framework. Agents produce typed outputs that the StateGraph consumes; the Risk Engine governs all execution authority (ADR-0003).

The project requires:
1. A typed contract that isolates the core from LLM frameworks
2. A concrete LLM provider for agent reasoning
3. Deterministic fallback when no LLM is available
4. Zero LLM dependencies in the agents package at the type level

## Decision

The cognitive layer lives behind an in-house `AgentAdapter` contract (`run(input: AgentInput) => Promise<AgentOutput>`). The StateGraph only consumes typed, validated outputs and never depends on an LLM framework.

**LLM Runtime:** OpenRouter is the LLM provider, accessed through the Vercel AI SDK adapter. The concrete `generateText` function from the `ai` package is injected via a `generateFn` parameter — the agents package never imports `ai` or `@ai-sdk/openai` directly. This keeps ARCHITECTURE.md boundaries clean: `agents` depends only on `contracts`.

**Behavioral Runtimes:** Three deterministic adapters operate without any LLM:
- `AuditConsultativeAdapter` — scores decision quality and emits summaries
- `MemoryConsultativeAdapter` — recalls prior incidents from durable JSON storage
- `PolicyConsultativeAdapter` — reviews internal limits and blocked venues

These are always available regardless of LLM configuration.

**Agent Catalog:** 11 consultative agents are defined in `CONSULTATIVE_AGENT_CATALOG` with explicit configurations, permissions, runtime declarations, and fallback strategies. When `LLM_API_KEY` is configured, deliberative agents (Bull, Bear, Skeptic, Risk Analyst, Execution Advisor) activate with real LLM reasoning via OpenRouter. Without an LLM, the system operates deterministically using behavioral adapters.

**Wiring:** The `VercelAISDKAdapter` and `createOpenRouterGenerateFn` are available via subpath exports (`@agenttrading/agents/runtimes/vercel`, `@agenttrading/agents/runtimes/openrouter`). The CLI package imports `ai` and `@ai-sdk/openai` and creates the concrete `generateFn` — the LLM dependency lives at the wiring layer, not in the agents package.

## Options considered

1. **Direct LLM import in agents package** — rejected. Would violate ARCHITECTURE.md boundary rules and create compile-time coupling to a specific LLM framework.

2. **Mastra as primary runtime** — deferred. Mastra adds value for durable memory, evals, and debate workflows, but the current operational need is satisfied by OpenRouter + Vercel AI SDK. Mastra can be added as a second runtime when debate workflows are activated.

3. **No LLM at all (deterministic only)** — rejected. The system needs cognitive reasoning for regime interpretation, opportunity debate, and context-aware risk narration. Behavioral runtimes provide fallback, not primary reasoning.

## Consequences

- **Positive:** Agents package has zero LLM dependencies at the type level. Boundary tests enforce this. LLM provider can be swapped without changing agents code.
- **Positive:** Behavioral runtimes ensure the system works without any LLM configured. Deterministic fallback is always available.
- **Positive:** The `generateFn` injection pattern means the same `VercelAISDKAdapter` works with OpenRouter, OpenAI, Anthropic, or any OpenAI-compatible provider.
- **Negative:** The CLI package now depends on `ai` and `@ai-sdk/openai`, adding ~2MB to the dependency tree. This is acceptable since the CLI is the wiring layer.
- **Follow-up:** When debate workflows (Bull/Bear/Skeptic) are activated, evaluate adding Mastra as a second runtime for its durable memory and eval capabilities.
