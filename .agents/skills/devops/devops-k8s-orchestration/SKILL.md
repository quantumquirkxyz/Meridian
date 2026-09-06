---
name: devops-k8s-orchestration
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design and configure Kubernetes orchestration — cluster architecture, deployment strategies, service mesh, observability, auto-scaling, security policies — with reproducible infrastructure.
capabilities:
  - design cluster topology (control plane, nodes, namespaces, RBAC)
  - configure deployment strategies (rolling, blue/green, canary, A/B)
  - set up service mesh (Istio, Linkerd) for traffic management
  - implement auto-scaling (HPA, VPA, cluster-autoscaler)
  - define pod security and network policies
outputs:
  - Kubernetes manifests (YAML) for deployment and services
  - Architecture diagram with namespace and service layout
  - Monitoring and alerting rules (Prometheus / Grafana / Jaeger)
sideEffects: []
dependencies: []
stopCondition: Manifests saved; architecture documented; monitoring rules defined.
risk: medium
trustTier: 3
maxIterations: 6
---

## Contract

- **Input:** application architecture, traffic patterns, availability target, resource constraints.
- **Output:** Kubernetes manifests + architecture documentation + monitoring rules.
- **Side effects:** may create resources when executed (deployment, service, configmap).
- **Dependencies:** Kubernetes cluster access (if execution required).
- **Stop condition:** manifests saved; architecture documented.
- **Risk:** medium — production deployment can cause outages; design-only by default.
- **Boundary:** produces manifests and design; deployment only when explicitly executed.

# Kubernetes Orchestration Design

Design a **Kubernetes deployment** — architecture, deployment strategy, service mesh, observability — with reproducible manifests.

## Process

### 1. Architecture design
- **Namespaces:** production, staging, development, monitoring.
- **Node pools:** compute-optimised vs memory-optimised; spot instances.
- **Control plane:** managed (GKE/EKS/AKS) vs self-hosted.
- **Networking:** CNI (Calico, Cilium, Flannel); ingress controller (NGINX, Traefik); service mesh (Istio / Linkerd).

**Completion criterion:** architecture diagram saved.

### 2. Deployment strategy
- **Rolling update:** incremental; safe for stateless.
- **Blue/Green:** instant switch; requires double capacity during transition.
- **Canary:** small percentage to new version; automatic rollback on error rate.
- **A/B:** split traffic by feature flags.

State which fits the service (stateless / stateful / critical / experimental).

**Completion criterion:** strategy selected with justification.

### 3. Resource and scaling
- Resource requests/limits (CPU / memory) per container.
- Horizontal Pod Autoscaler (HPA) based on CPU / memory / custom metrics.
- Vertical Pod Autoscaler (VPA) for right-sizing.
- Cluster autoscaler for node scaling.

**Completion criterion:** resource specs defined; scaling rules saved.

### 4. Security policies
- Pod Security Standards (restricted / privileged / baseline).
- Network policies (deny all; allow only required ports / sources).
- RBAC: least-privilege service accounts; no root containers.
- Secret management: Kubernetes secrets / external (Vault / AWS Secrets Manager / GCP Secret Manager).
- Image scanning: vulnerability scanning in CI.

**Completion criterion:** security policies defined.

### 5. Observability
- **Metrics:** Prometheus / Grafana (custom metrics, SLIs).
- **Logs:** structured logs (JSON); centralised (ELK / Loki / CloudWatch).
- **Tracing:** Jaeger / OpenTelemetry for distributed traces.
- **Alerts:** alert on error rate, latency, resource exhaustion, security events.

**Completion criterion:** monitoring rules defined.

### 6. Deliver

Manifests (YAML) + architecture diagram + monitoring rules + deployment runbook (how to roll back).
