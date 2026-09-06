---
name: ai-prompt-engineering
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design, evaluate, and refine prompts for LLMs (GPT-4, Claude, Llama, Mistral) with chain-of-thought, few-shot, RAG, and evaluation metrics.
capabilities:
  - structure prompts with system, user, context, output-format instructions
  - apply chain-of-thought, few-shot, RAG, and tool-use patterns
  - evaluate prompts with metrics (accuracy, consistency, latency, cost)
  - iterate with A/B testing of prompt variants
outputs:
  - Prompt library (Markdown with variants and performance notes)
  - Evaluation report (metrics per variant, failure mode analysis)
  - Recommendation (best variant + justification)
sideEffects: []
dependencies: []
stopCondition: Best prompt identified with evaluation report; failure modes documented.
risk: medium
trustTier: 3
maxIterations: 6
---

## Contract

- **Input:** task description, target LLM, evaluation criteria.
- **Output:** prompt library + evaluation report + recommendation.
- **Side effects:** may call LLM APIs (cost, data privacy).
- **Dependencies:** LLM API access (OpenAI, Anthropic, local model server).
- **Stop condition:** best variant selected with evaluation evidence.
- **Risk:** medium — LLM outputs can be unreliable; requires validation; data privacy concerns.
- **Boundary:** evaluates and selects prompts; does not deploy to production without additional validation.

# Prompt Engineering

Design **LLM prompts** that produce correct, consistent, and useful outputs — with evaluation, iteration, and failure-mode analysis.

## Process

### 1. Frame the task
State exactly what the LLM should do:
- Information extraction / summarisation.
- Code generation / explanation.
- Reasoning / proof / analysis.
- Creative generation.
- Classification / labeling.

**Completion criterion:** task statement precise; success criteria defined.

### 2. Design the prompt
Structure with clear sections:
- **System message:** role and constraints (e.g. "You are a careful mathematician.").
- **Context:** background, relevant data, rules.
- **Instruction:** what to do; format of output.
- **Examples:** zero-shot, few-shot (2–5 examples with input/output pairs), chain-of-thought (show reasoning steps before answer).
- **Constraints:** length, tone, forbidden content.
- **Output format:** JSON, Markdown, list, single paragraph.

**Completion criterion:** prompt structure explicit; examples selected.

### 3. Evaluate variants
Test at least 3 variants (baseline, improved, best guess):
- **Accuracy** — correct vs reference answer.
- **Consistency** — same answer across 3 runs with same prompt (temperature 0 or low).
- **Latency** — time per call.
- **Cost** — tokens used (input + output).
- **Failure modes** — what breaks (hallucination, refusal, partial answer, wrong format)?

**Completion criterion:** evaluation report with metrics and failure modes.

### 4. Iterate
Use failure modes to refine:
- Add constraints where over-generation occurs.
- Add examples where reasoning is shallow.
- Simplify instruction where confusion occurs.
- Add RAG (retrieve relevant docs) when knowledge is missing.

**Completion criterion:** at least 2 iterations; improvement documented.

### 5. Recommend
State the best variant with evidence; document when it fails; provide fallback rules.

**Completion criterion:** recommendation with justification.

## Notes

- Pair with `ai-ml-pipeline` when the prompt feeds into a model pipeline.
- Use `ai-model-evaluation` for deeper evaluation (fairness, robustness, cross-model comparison).
