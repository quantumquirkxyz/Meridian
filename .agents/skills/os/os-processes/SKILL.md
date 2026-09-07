---
name: os-processes
category: os
maturity: stable
version: 1
description: Design operating system process management — scheduling, signals, process states, concurrency, and inter-process communication — with explicit isolation boundaries.
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

# os-processes

- **Propósito**: Design operating system process management — scheduling, signals, process states, concurrency, and inter-process communication — with explicit isolation boundaries.
- **Contenido sugerido**: scheduler model, IPC choices, process lifecycle, and observability.
- **Estado**: defined as a practical OS specialization.
