# 0005 — Personal project without KYC; internal operational policy only

Status: accepted
Date: 2026-08-13
Deciders: Jhuomar Boskoll Quintero

## Context

Crypto trading infrastructure operates in a regulatory environment that varies by jurisdiction. The European Union (MiCA), IOSCO, and national regulators have frameworks for cryptoasset service providers, including KYC/AML requirements, licensing, and operational obligations.

The question is: should this system implement compliance features, or should it be a personal technical project?

## Decision

The project is **personal and does not implement commercial KYC/AML or an external regulatory layer**. Instead, a Policy Agent verifies internal limits, blocked venues, user-configured terms of service, and the project's own policies. Regulatory knowledge (MiCA, IOSCO/FSB) is used only to understand structural risks (technological, custody, operational, MEV, manipulation) — not as a compliance obligation.

## Options considered

1. **Full KYC/AML implementation** — Rejected. This is a personal project, not a commercial service. Implementing KYC would require identity verification providers, transaction monitoring, suspicious activity reporting, and ongoing compliance maintenance. The operational cost is disproportionate to the project's scope.

2. **Partial compliance (KYC for live mode only)** — Rejected. Mixing personal and commercial compliance creates confusion about the system's nature. The system is either personal or commercial; it cannot be both.

3. **Internal policy only** — Accepted. The Policy Agent enforces internal rules: maximum exposure per venue, blocked venues, user-configured terms, and the project's own risk policies. This provides operational safety without regulatory overhead.

## Consequences

- **Positive:** The system can operate without regulatory overhead, licensing, or compliance infrastructure.
- **Positive:** The Policy Agent provides internal safety that is relevant to the system's operation (blocked venues, exposure limits) without the burden of external compliance.
- **Negative:** The system cannot be commercialized without significant compliance work. If the project ever needs to serve external users, KYC/AML must be added from scratch.
- **Negative:** The system must not interact with sanctioned entities, restricted jurisdictions, or prohibited activities. This is enforced by the Policy Agent's internal rules, not by external compliance infrastructure.
- **Note:** Regulatory knowledge is maintained in the codebase to understand structural risks (e.g., MiCA implications for DEX routing, IOSCO concerns about market manipulation). This knowledge informs risk assessment, not compliance implementation.
