---
name: agent-observability
description: Capture redacted execution records, traces, and quality signals for Skill runs with structured data for analysis.
version: 2
capabilities:
  - capture-execution-record
  - redact-sensitive-data
  - structure-data-for-analysis
  - link-to-outputs-and-evidence
inputs:
  - skill-execution-context
  - raw-execution-data
outputs:
  - redacted-execution-record
  - structured-analysis-data
  - traceability-links
dependencies: []
sideEffects:
  - write-docs
stopCondition: An execution record has been captured, redacted, structured for analysis, and linked to relevant outputs or validation evidence.
risk: low
trustTier: 2
---

# Agent Observability

Use this skill to make Skill runs observable without leaking sensitive data, while providing structured data for later analysis.

## Contract

- Input: skill execution context and raw execution data
- Output: redacted execution record, structured analysis data, and traceability links
- Scope: observation of skill execution for quality improvement and debugging
- Rule: all personally identifiable information, secrets, and sensitive data must be redacted
- Rule: structured data must enable analysis of patterns without compromising privacy
- Rule: outputs must link to validation evidence when available

## Steps

### 1. Capture Execution Context
- Capture the Skill name, version, context pack used, and tools invoked
- Record timestamp, duration, and compute resources used
- Note the inputs provided to the skill and the triggering context

### 2. Redact Sensitive Data
- Identify and redact secrets (API keys, passwords, tokens)
- Redact personally identifiable information (email addresses, names, internal identifiers)
- Redact sensitive project-specific data that could reveal competitive information
- Use pattern matching and rule-based approaches for reliable redaction
- Preserve non-sensitive structural information for analysis

### 3. Structure Data for Analysis
- Organize data in consistent, analyzable formats (JSON preferred)
- Include standardized fields for common analysis patterns:
  * Skill invocation patterns and parameters
  * Execution timing and resource usage
  * Success/failure outcomes and error types
  * Input/output characteristics and data flow
  * Dependency invocation patterns
- Ensure structure supports aggregation and trend analysis over time

### 4. Link to Outputs and Validation Evidence
- Create traceable links to any artifacts produced by the skill
- Link to validation evidence when available (test results, lint reports, etc.)
- Preserve causality chains for debugging and root cause analysis
- Enable skills to be understood in the context of larger workflows

## Completion Criteria

- the execution record is thoroughly redacted of all sensitive data
- the data is structured in a consistent format suitable for analysis
- the record maintains traceability to skill inputs, execution, and outputs
- validation evidence is linked when available
- the record enables retrospective analysis without compromising security

## Data Usage Guidelines

This skill provides observability data that can be used for:

### Quality Improvement
- Identifying frequently failing skills or patterns
- Understanding skill performance characteristics
- Detecting regressions in skill behavior over time

### Learning and Training
- Providing examples of successful skill executions
- Showing common patterns of skill composition
- Illustrating effective use of skill combinations

### System Health
- Monitoring overall skill ecosystem health
- Identifying bottlenecks or resource-intensive operations
- Tracking adoption and usage patterns of different skills

### Important Limitations
- This skill does NOT perform analysis itself - it only provides data
- Analysis must be performed separately using appropriate tools
- The data represents observations, not guarantees or predictions
- Privacy protection takes precedence over analytical completeness