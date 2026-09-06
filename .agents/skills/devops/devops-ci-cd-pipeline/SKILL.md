---
name: devops-ci-cd-pipeline
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design CI/CD pipelines — build, test, security scan, deploy, rollback — with reproducible steps, environment parity, and deployment gates.
capabilities:
  - design pipeline stages (build, test, security, deploy, rollback)
  - configure environment parity (dev/staging/prod with same tool versions)
  - define deployment gates (tests pass, security scan clean, approval required)
  - document rollback procedures
outputs:
  - Pipeline definition (YAML / JSON / script)
  - Environment parity checklist
  - Deployment gate rules
sideEffects: []
dependencies: []
stopCondition: Pipeline file saved; gate rules documented; rollback plan present.
risk: medium
trustTier: 3
maxIterations: 5
---

## Contract

- **Input:** application architecture, deployment environment, quality requirements.
- **Output:** pipeline definition + gate rules + rollback plan.
- **Side effects:** may trigger builds/deployments when executed.
- **Dependencies:** CI/CD platform (GitHub Actions / GitLab CI / Jenkins / CircleCI / Travis).
- **Stop condition:** pipeline definition saved; gate rules documented.
- **Risk:** medium — deployment errors cause outages; requires testing.
- **Boundary:** defines pipeline; does not execute production deployment unless explicitly instructed.

# CI/CD Pipeline Design

Design a **CI/CD pipeline** — build, test, security, deploy, rollback — with reproducible steps and deployment gates.

## Process

### 1. Define stages
- **Build:** compile / package / dependency install; reproducible (lock files, container).
- **Test:** unit, integration, contract, performance; must pass before deploy.
- **Security:** dependency scan, secret scan, static analysis (SAST), dynamic (DAST if applicable).
- **Deploy:** to staging first; promotion to prod with gate.
- **Rollback:** automated (revert to previous version) or manual (with decision log).

**Completion criterion:** stages named; order defined; gates stated.

### 2. Environment parity
- Dev / staging / production use identical container images / dependency versions.
- Configuration is externalised (env vars / configmaps / secrets manager), not baked into image.
- Database migrations run before deploy; rollback plan for migration errors.

**Completion criterion:** parity checklist saved.

### 3. Deployment gates
- All tests pass.
- Security scan clean (no critical / high vulnerability unmitigated).
- Approval required for production (manual or automated based on risk).
- Feature flags for gradual rollout.

**Completion criterion:** gate rules saved.

### 4. Rollback
- Previous version kept (blue/green or rolling with old pods)
- Rollback trigger: error rate threshold, latency spike, manual decision.
- Rollback time target (e.g. < 5 minutes for stateless; < 15 minutes for stateful).

**Completion criterion:** rollback plan saved.

### 5. Deliver
Pipeline file (YAML / JSON / script), gate rules, rollback plan, environment parity checklist.
