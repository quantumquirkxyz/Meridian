---
name: math-cryptography
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Analyse cryptographic constructions — symmetric, asymmetric, hashing, MACs, zero-knowledge — with security reductions, hardness assumptions, and attack analysis.
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact satisfying completion criteria
outputs:
  - Markdown artifact with all process steps completed
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved with all required sections present.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem description and inputs defined by the skill body.
- **Output:** Markdown artifact with completed process steps.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** all process steps executed; artifact saved with required sections.
- **Risk:** low.
- **Boundary:** produces reasoning artifact only; no system changes.


# Cryptographic Analysis

Analyse or design a **cryptographic construction** with explicit hardness assumptions, security reductions, and attack analysis.

## When to use

- The user wants a cryptographic protocol reviewed or designed.
- A security-critical component needs formal analysis.
- Key exchange, signatures, MACs, encryption, or ZK proofs are involved.

## Process

1. Identify the primitive type — symmetric encryption (block ciphers, stream ciphers), asymmetric (RSA, ECC, lattice-based), hash (collision-resistant, preimage), MAC / HMAC, signatures, key exchange, ZK proofs.
2. State hardness assumptions — DLP, CDH, DDH, RSA,factoring, LWE, SIS; quantify security level in bits.
3. Security goal — IND-CPA, IND-CCA, EUF-CMA, collision resistance, etc.
4. Attack analysis — birthday (hash), meet-in-the-middle, side-channel, replay, forward secrecy, oracle attacks.
5. Protocol design — if designing: use a well-known construction; do not invent primitives. Specify parties, messages, randomness sources, and secrets.
6. Deliver — artifact: primitive, hardness assumption, security goal, attack surface, and a security verdict (strong / moderate / weak / broken).
