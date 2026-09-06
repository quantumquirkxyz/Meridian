---
name: devops-feature-flags
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design feature flag systems — gradual rollouts, A/B experiments, kill switches, targeting rules — with lifecycle management and operational runbooks.
capabilities:
  - design flag lifecycle (create → gradual rollout → full → remove)
  - configure targeting rules (user segment, percentage, environment)
  - design kill switches and emergency rollback
  - manage flag inventory and technical debt
outputs:
  - Feature flag lifecycle document
  - Targeting rules template
  - Flag inventory with owners and retirement dates
sideEffects: []
dependencies: []
stopCondition: Lifecycle documented; targeting rules defined; flag inventory saved.
risk: medium
trustTier: 3
maxIterations: 4
---

## Contract

- **Input:** features to control, rollout requirements, environments.
- **Output:** flag lifecycle + targeting rules + inventory.
- **Side effects:** none (design only; execution requires flag platform).
- **Dependencies:** feature flag platform (LaunchDarkly / Split / Unleash / Flagsmith / in-house).
- **Stop condition:** lifecycle and targeting rules documented.
- **Risk:** medium — flag mishandling can expose unready features or cause outages.
- **Boundary:** designs flag system; does not deploy flags unless explicitly instructed.

# Feature Flag System Design

Design a **feature flag system** — rollouts, targeting, kill switches — with lifecycle management and operational runbooks.

## Process

### 1. Flag types
- **Release flag:** hide unfinished features from users; enable in dev/staging.
- **Experiment flag:** A/B test; percentage split; metric tracking.
- **Ops flag:** kill switch / circuit breaker (e.g. disable expensive recommendation engine).
- **Permission flag:** gradual rollout to user segments (beta users, tiers, regions).

**Completion criterion:** flag types mapped to features.

### 2. Lifecycle design
Every flag goes through:
1. **Created:** default off.
2. **Gradual rollout:** 1% → 10% → 50% → 100%.
3. **Full release:** flag kept for quick rollback or removed if not needed.
4. **Retired:** removed from code within N sprints.

**Completion criterion:** lifecycle documented per flag type.

### 3. Targeting rules
- Percentage-based (random or deterministic).
- User segment (tier, region, language, plan type).
- Environment (dev / staging / prod).
- Custom rules (date-based, device type, account age).

**Completion criterion:** targeting rules template saved.

### 4. Kill switches and emergency rollback
- Ops flags: what to do if the flag causes an outage? (disable immediately; have runbook)
- Rollback time: must be < 5 minutes for critical paths.
- Alert: flag change should trigger an alert to on-call.

**Completion criterion:** kill switch runbook saved.

### 5. Flag inventory
Per flag: name, owner, purpose, type, created date, retirement date, dependencies.

**Completion criterion:** inventory saved and reviewed quarterly.

### 6. Deliver
Flag lifecycle document + targeting rules template + flag inventory.
