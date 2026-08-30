---
name: auth
description: Design authentication and authorization as a small, explicit seam with clear caller and operator responsibilities.
version: 1
capabilities:
  - design-auth-seam
  - shape-access-control
  - define-identity-contract
inputs:
  - auth brief
  - identity context
  - security constraints
outputs:
  - auth seam proposal
  - access-control guidance
  - identity contract
  - threat and failure notes
dependencies:
  - codebase-design
  - api-design
sideEffects:
  - read-only
stopCondition: The auth seam and access-control contract are explicit enough to implement or review.
risk: medium
---

# Auth

Use this skill when a project needs authentication or authorization defined before implementation. Keep the seam small and the responsibilities explicit: who is the user, who can act, and where the trust boundary sits. Treat identity as untrusted input until the project has verified it at the declared boundary.

## Contract

- Input: auth brief, identity context, and security constraints.
- Output: an auth seam proposal, access-control guidance, an identity contract, and threat and failure notes.
- Scope: design the auth shape, not the full implementation.
- Rule: distinguish authentication from authorization.
- Rule: make the trust boundary explicit before choosing providers or protocols.
- Rule: keep the caller contract small enough that backend refactors do not leak into user-facing flows.
- Rule: default to deny when identity, session state, tenant context, or required permission is missing or stale.
- Rule: define session/token lifetime, revocation behavior, and credential or secret handling at the level needed to prevent accidental persistence.
- Rule: separate resource ownership, roles, and service-to-service identity when they are different decisions.
- Rule: identify security-sensitive events that require an audit trail without logging credentials or raw tokens.

## Steps

1. Identify the identity source, trust boundary, and actors: human, service, job, or anonymous caller.
2. Define the identity contract: stable subject, tenant or account context, freshness, and verified claims.
3. Separate authentication from authorization decisions, including ownership, roles, scopes, and deny behavior.
4. Describe session or token lifecycle, revocation, secret handling, and the failure response for invalid or unavailable identity.
5. Define the smallest caller-facing seam and list security events that operators must be able to audit.
6. Note provider, protocol, or data-model lock-in implied by the decision.

## Completion criteria

- the trust boundary is named
- the identity contract includes freshness and failure behavior
- the authorization model and default-deny behavior are explicit
- lifecycle, audit, and lock-in risks are recorded
