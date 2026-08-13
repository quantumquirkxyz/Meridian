# 0002 — Own minimal StateGraph as the orchestration core

We build a **minimal in-house implementation** of a state graph (state machine + guard conditions + typed handoffs + permissions + deterministic fallbacks + per-transition audit), conceptually inspired by LangGraph but **without LangGraph as a central dependency**. The system is financially deterministic before it is agentic-conversational: the core must survive without any LLM.

LangGraph remains only as conceptual reference; Mastra/Vercel AI SDK as the auxiliary cognitive layer; Temporal (in Gamma) for durable execution. See ADR-0003 for the rule that agents never govern execution.
