---
name: backend-caching
category: backend
maturity: stable
version: 1
description: Design backend caching strategies — cache keys, TTLs, invalidation, stale-while-revalidate, and cache coherence — with explicit consistency and failure trade-offs.
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

# backend-caching

- **Propósito**: Design backend caching strategies — cache keys, TTLs, invalidation, stale-while-revalidate, and cache coherence — with explicit consistency and failure trade-offs.
- **Contenido sugerido**: cache topology, eviction, invalidation, and verification.
- **Estado**: defined as a practical backend specialization.
