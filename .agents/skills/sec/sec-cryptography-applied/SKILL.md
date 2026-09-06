---
name: sec-cryptography-applied
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Apply cryptography — encryption at rest / in transit, digital signatures, key management, MACs, TLS/PKI, HSM, secure enclaves — with implementation guidance and anti-patterns.
capabilities:
  - select cryptographic primitives (AES-GCM, ChaCha20-Poly1305, Ed25519, RSA-OAEP)
  - design key management (generation, rotation, storage, HSM, KMS)
  - implement TLS / mTLS correctly (certificate chain, TLS 1.3, cipher suites)
  - audit cryptographic usage for weaknesses
outputs:
  - Cryptographic design document
  - Implementation checklist (key length, mode, IV, padding, rotation)
  - Anti-patterns identified and corrected
sideEffects: []
dependencies: []
stopCondition: Design document saved; anti-patterns corrected or documented; checklist complete.
risk: medium
trustTier: 3
maxIterations: 5
---

## Contract

- **Input:** data to protect, threat model, regulatory requirements.
- **Output:** cryptographic design + implementation checklist.
- **Side effects:** none (design only).
- **Dependencies:** none.
- **Stop condition:** design saved; anti-patterns identified; checklist complete.
- **Risk:** medium — weak cryptography has severe consequences.
- **Boundary:** designs cryptographic system; does not deploy unless explicitly executed.

# Applied Cryptography

Apply **cryptography** correctly — encryption, signatures, key management, TLS — with implementation guidance and anti-pattern detection.

## Process

### 1. Classify the data
- Sensitivity: public / internal / confidential / secret.
- Regulatory: GDPR (PII encryption), PCI-DSS (cardholder data), HIPAA (PHI), financial (PSD2), government (FIPS 140-2).
- At-rest vs in-transit vs in-use protection needed.

**Completion criterion:** data classification and protection requirements saved.

### 2. Choose primitives
- **Encryption:** AES-GCM (default), ChaCha20-Poly1305 (mobile / constrained), never ECB or unauthenticated CBC.
- **Key exchange:** X25519 (ECDH), RSA-KEM (hybrid).
- **Signatures:** Ed25519 (default), ECDSA (interoperability), RSA-PSS (legacy).
- **Hashing:** SHA-256 (SHA-3 as backup); Argon2id for passwords; BLAKE3 for fast hashing.
- **MAC:** HMAC-SHA256 (default); Poly1305 (with ChaCha20).

**Completion criterion:** primitives selected with justification.

### 3. Key management design
- **Generation:** cryptographically secure random number generator (CSPRNG); HSM for high-security keys.
- **Storage:** encrypted at rest; never hardcoded; use KMS (AWS KMS / GCP Cloud KMS / Azure Key Vault) or HSM.
- **Rotation:** automatic rotation schedule (e.g. annual for encryption keys; 90-day for session keys).
- **Destruction:** secure wipe when key expires.

**Completion criterion:** key management design saved.

### 4. TLS / PKI
- TLS 1.3 only (TLS 1.2 only if legacy requires; disable older versions).
- Cipher suite: only AEAD (AES-GCM, ChaCha20-Poly1305); disable RC4, 3DES, CBC.
- Certificate: issued by trusted CA; certificate chain validated; mutual TLS (mTLS) for service-to-service.
- HSTS header; OCSP stapling.

**Completion criterion:** TLS configuration documented.

### 5. Anti-pattern audit
Check for: hardcoded keys, password-based encryption (use KDF: Argon2id / scrypt), ECB mode, no MAC on encrypted data, IV reuse, missing key rotation, weak random, deprecated algorithms (MD5, SHA1 for signatures), lack of forward secrecy.

**Completion criterion:** anti-patterns listed; each fixed or documented with justification.

### 6. Deliver
Cryptographic design document + implementation checklist (key lengths, modes, rotation schedule) + anti-pattern corrections.
