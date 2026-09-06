---
name: web3-smart-contracts
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design and review smart contracts — security, gas optimization, upgradeability, access control — with an adversarial review step.
capabilities:
  - review smart contract security (reentrancy, access, arithmetic, gas)
  - audit upgradeability and governance mechanisms
  - perform adversarial review
outputs:
  - Markdown artifact: requirements, security review, gas audit, adversarial scenarios, deployment recommendation
sideEffects: []
dependencies: []
stopCondition: Artifact present with deployment recommendation.
risk: medium
trustTier: 2
maxIterations: 6
---

## Contract

- **Input:** smart contract code / requirements.
- **Output:** review artifact.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** deployment recommendation explicit.
- **Risk:** medium — security-sensitive; careful review required.
- **Boundary:** design/review only; no deployment execution.
---

# Smart Contract Design & Review

Design or review a **smart contract** — state, access control, gas, upgrade path — and subject it to an adversarial review before any deployment recommendation.

## When to use

- The user wants to design a smart contract architecture or review existing code.
- A DeFi protocol, token, NFT, or governance contract needs security analysis.
- Another skill (`web3-tokenomics`, `quant-factors` for crypto) needs contract-level grounding.

## Process

### 1. Capture requirements

State the contract's purpose: what state does it hold? What actions change it? What events does it emit? Who calls it?

**Completion criterion:** purpose and state-change surface documented.

### 2. Security review checklist

Check each item; do not skip:

- **Reentrancy:** can an external call be re-entered? Use checks-effects-interactions or ReentrancyGuard.
- **Access control:** which roles exist; how roles are granted and revoked; what happens if an admin is compromised.
- **Integer arithmetic:** overflow / underflow; use SafeMath or native overflow protection.
- **Gas denial:** unbounded loops; gas limits on external calls.
- **Upgradeability:** proxy pattern (UUPS, transparent) — what is the upgrade logic? Who triggers it?
- **Pull vs push:** payments pulled by recipients reduce reentrancy risk.
- **External dependencies:** oracles, other contracts, libraries — what if they fail?

**Completion criterion:** each checklist item addressed explicitly; missing protections named.

### 3. Gas audit

Identify gas hotspots:

- Storage writes (SSTORE is expensive).
- Loops over arrays or mappings.
- Redundant computations.
- Unused variables / dead code.

Suggest optimisations that don't compromise security.

**Completion criterion:** top gas costs identified; at least one cost-reducing recommendation.

### 4. Upgrade / governance path

If upgradeable:

- What is the upgrade mechanism?
- Who holds upgrade rights?
- What prevents malicious upgrades?
- How is the upgrade event logged / audited?

If immutable:
- How are bugs handled?
- What is the migration path?

**Completion criterion:** upgrade mechanism and governance fully described.

### 5. Adversarial review

Write the contract from an attacker's perspective:

- What is the most damaging sequence of calls?
- What happens at extreme inputs (zero, max, empty state)?
- What happens if the owner key is lost / stolen?
- What happens if an external dependency fails?

Document each attack path; state whether it is mitigated, unmitigated, or out of scope.

**Completion criterion:** at least one adversarial scenario documented with impact and mitigation status.

### 6. Deliver

Markdown artifact: requirements, security review, gas audit, upgrade/governance, adversarial scenarios, and a **deployment recommendation** — deploy, deploy with fixes listed, or do not deploy.

**Completion criterion:** artifact present; deployment recommendation is explicit.
