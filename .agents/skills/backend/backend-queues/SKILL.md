---
name: backend-queues
category: backend
maturity: stable
version: 1
description: Design backend queues and background job systems — durability, retries, ordering, idempotency, and backpressure — with explicit delivery guarantees.
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact or structured result
outputs:
  - Markdown artifact with process steps and completion criteria
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved; criteria met.
risk: low
trustTier: 1
maxIterations: 6
---

# backend-queues

- **Propósito**: Design backend queues and background job systems — durability, retries, ordering, idempotency, and backpressure — with explicit delivery guarantees.
- **Contenido sugerido**: queue semantics, worker lifecycle, retry policy, and observability.
- **Estado**: defined as a practical backend specialization.
