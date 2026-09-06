---
name: devops-terraform-iac
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design infrastructure as code — Terraform / Pulumi / CloudFormation — for reproducible, version-controlled, auditable cloud infrastructure.
capabilities:
  - define infrastructure modules (compute, network, storage, identity)
  - manage state (remote backend, state locking, state encryption)
  - design environment isolation (dev/staging/prod via workspaces / separate states)
  - enforce policies (IAM least-privilege, network rules, encryption at rest / in transit)
outputs:
  - Terraform / Pulumi module definitions (HCL / TypeScript / YAML)
  - State management rules
  - Policy / compliance checklist
sideEffects: []
dependencies: []
stopCondition: Module definitions saved; state rules saved; policy checklist filled.
risk: medium
trustTier: 3
maxIterations: 5
---

## Contract

- **Input:** infrastructure requirements (compute, storage, network, identity, policies).
- **Output:** IAC module definitions + state rules + policy checklist.
- **Side effects:** may create resources when executed (plan/apply).
- **Dependencies:** cloud provider access (AWS / GCP / Azure / local).
- **Stop condition:** definitions and rules saved.
- **Risk:** medium — IAC errors cause outages or data loss; requires testing (terraform plan / dry-run).
- **Boundary:** defines infrastructure; execution requires explicit approval and testing.

# Infrastructure as Code Design

Design **reproducible infrastructure** — compute, network, storage, identity — with version control, state management, and policy enforcement.

## Process

### 1. Define requirements
- Compute: instances / containers / serverless / managed Kubernetes.
- Storage: object, block, database, cache, archive.
- Network: VPC, subnets, load balancers, DNS, CDN, VPN, private links.
- Identity: IAM roles, service accounts, SSO integration.

**Completion criterion:** requirements list saved.

### 2. Design modules
- **Module** per concern: compute module, network module, storage module, identity module.
- Each module defines resources, variables, outputs.
- Composition: root module calls sub-modules with variables.

**Completion criterion:** module tree saved.

### 3. State management
- Remote backend (S3 / GCS / Azure Storage with locking).
- State encryption (at rest / in transit).
- State isolation per environment (workspaces / separate state files).
- State versioning / backup.

**Completion criterion:** state rules saved.

### 4. Policy enforcement
- IAM: least-privilege roles; no root/admin by default; service-specific roles.
- Network: default-deny; allow only required ports / sources; private subnets for databases.
- Encryption: at rest (AES-256) and in transit (TLS 1.3); key management.
- Compliance: GDPR / SOC2 / HIPAA / ISO 27001 rules mapped to controls.

**Completion criterion:** policy checklist filled.

### 5. Deliver
Module definitions (HCL / TypeScript / YAML) + state rules + policy checklist + plan example (terraform plan output or equivalent).
