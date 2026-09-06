---
name: sec-threat-modeling
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design and document threat models for software / systems — assets, threats, vulnerabilities, mitigations — using STRIDE or ATT&CK frameworks.
capabilities:
  - identify assets and trust boundaries
  - apply STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)
  - apply ATT&CK (tactics, techniques, procedures) for adversarial analysis
  - document mitigations and residual risk
outputs:
  - Threat model document (diagram + table)
  - Risk register (asset × threat × vulnerability × mitigation)
sideEffects: []
dependencies: []
stopCondition: Threat model saved; all assets mapped; risk register complete.
risk: low
trustTier: 1
maxIterations: 5
---

## Contract

- **Input:** system architecture, data flows, users, deployment environment.
- **Output:** threat model document + risk register.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** all assets mapped; risk register filled.
- **Risk:** low.
- **Boundary:** designs threat model; does not implement mitigations.

# Threat Modeling

Build a **threat model** — assets, threats, vulnerabilities, mitigations — using STRIDE or ATT&CK.

## Process

### 1. Define assets
What must be protected? Data (PII, credentials, business data), services (API, database), systems (servers, containers), users.

**Completion criterion:** asset list with value/criticality.

### 2. Map architecture
- Data flow diagram: sources → processes → stores → sinks.
- Trust boundaries: where do privileges change? (user → service → database → external API)
- External dependencies: third-party APIs, SaaS, cloud providers.

**Completion criterion:** diagram saved; trust boundaries marked.

### 3. Identify threats
Use STRIDE per component:
- **Spoofing:** can an attacker impersonate a user / service?
- **Tampering:** can data be altered in transit / at rest?
- **Repudiation:** can actions be denied? (lack of logging / audit)
- **Information Disclosure:** can sensitive data leak (logs, errors, unencrypted storage)?
- **Denial of Service:** can resources be exhausted?
- **Elevation of Privilege:** can a low-privilege user gain admin?

**Completion criterion:** threat table with evidence and likelihood.

### 4. Assess vulnerabilities
How could each threat succeed? Weak authentication? Unvalidated input? Missing encryption? Overly permissive access control?

**Completion criterion:** vulnerability mapped per threat.

### 5. Design mitigations
For each threat-vulnerability pair: what control (preventive / detective / corrective) reduces likelihood or impact? (Encryption, authentication, validation, logging, rate limiting, backup, least privilege).

**Completion criterion:** mitigation table with responsible party.

### 6. Residual risk
After mitigations: is risk acceptable? If not, add more controls or accept with justification.

**Completion criterion:** residual risk stated; justification if accepted.
