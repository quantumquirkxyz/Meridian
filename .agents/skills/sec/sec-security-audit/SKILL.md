---
name: sec-security-audit
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Audit software/security posture — code review, dependency scanning, secret detection, access control, audit logging — with explicit findings and remediation priorities.
capabilities:
  - review code for security vulnerabilities (OWASP, CWE, SANS)
  - scan dependencies (SAST, DAST, dependency-check, Semgrep)
  - audit access control and secrets management
  - document findings with severity and remediation priority
outputs:
  - Security audit report (findings, severity, recommendations)
  - Remediation checklist (prioritised by risk)
sideEffects: []
dependencies: []
stopCondition: Audit report complete; findings classified by severity; recommendations made.
risk: medium
trustTier: 3
maxIterations: 6
---

## Contract

- **Input:** code repository or system description, threat model (optional).
- **Output:** audit report with severity-classified findings.
- **Side effects:** may run scanners (SAST, dependency-check); may read secrets (never expose in output).
- **Dependencies:** scanner tools, access to repo.
- **Stop condition:** report complete; all findings have severity + recommendation.
- **Risk:** medium — security findings can be sensitive; report should be handled confidentially.
- **Boundary:** finds and classifies; does not patch or deploy fixes (remediation is separate).

# Security Audit

Audit a **system or codebase** for security vulnerabilities — with explicit findings, severity, and remediation priorities.

## Process

### 1. Scope
State: codebase / service / infrastructure / policy; what is in scope (all code, specific module, API, database); what is out of scope (third-party SaaS, physical security).

**Completion criterion:** scope saved.

### 2. Threat model (optional but recommended)
Identify assets (data, services, credentials), threats (unauthorised access, data breach, denial of service), vulnerabilities, and mitigations.

**Completion criterion:** threat model saved if used.

### 3. Code review
Review for:
- Input validation (SQL injection, XSS, command injection, path traversal).
- Authentication / authorisation (broken access control, privilege escalation).
- Cryptography (weak algorithms, hardcoded keys, improper IV).
- Sensitive data exposure (logs, error messages, API responses).
- Dependency vulnerabilities (outdated libraries, known CVEs).

**Completion criterion:** review notes saved; findings linked to CWE / OWASP categories.

### 4. Dependency / secret scan
- Scan dependencies for CVEs.
- Search for secrets (API keys, passwords, tokens) in source.
- Check for hardcoded credentials.

**Completion criterion:** dependency and secret scan results saved.

### 5. Classify findings
For each finding: severity (Critical / High / Medium / Low / Informational); evidence (line, snippet); recommendation (fix, architecture change, process change).

**Completion criterion:** findings table complete.

### 6. Remediation priorities
Prioritise by: severity × likelihood × business impact. Suggest quick wins (low effort, high impact) first.

**Completion criterion:** remediation checklist with priority.

### 7. Report
Markdown artifact with: scope, methodology, findings table, recommendations, and a note on limitations (what was not tested).
