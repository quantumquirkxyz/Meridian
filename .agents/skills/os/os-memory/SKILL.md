---
name: os-memory
category: os
maturity: stable
version: 1
description: Design operating system memory systems — virtual memory, paging, allocation, swapping, and protection — with explicit resource accounting and locality assumptions.
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

# os-memory

- **Propósito**: Design operating system memory systems — virtual memory, paging, allocation, swapping, and protection — with explicit resource accounting and locality assumptions.
- **Contenido sugerido**: memory model, paging policy, allocator behavior, and failure modes.
- **Estado**: defined as a practical OS specialization.
