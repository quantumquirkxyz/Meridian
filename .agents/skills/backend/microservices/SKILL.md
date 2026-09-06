# microservices

Design microservice architectures — service decomposition, inter-service communication, data ownership, resilience patterns — with explicit boundaries and failure isolation.

## Goals
- Decompose monoliths into bounded services
- Define clear ownership of data and behavior
- Plan synchronous and asynchronous communication
- Design for resilience and observability

## Contract

### Input
A description of the system to decompose: domain model, current architecture, scaling needs.

### Output
A microservices decomposition with:
- Service map and ownership boundaries
- Communication patterns (sync/async)
- Data replication strategy
- Resilience patterns (retry, circuit breaker, timeout)

## Steps

1. **Map the domain** — identify bounded contexts and aggregates
2. **Define service boundaries** — single responsibility, high cohesion
3. **Assign data ownership** — which service owns which data
4. **Choose communication style** — REST, gRPC, message queue, event bus
5. **Design resilience** — timeouts, retries, circuit breakers, bulkheads
6. **Plan observability** — distributed tracing, centralized logging

## References
- `../backend-architecture/SKILL.md` — service design
- `../../platform/queueing/SKILL.md` — async messaging
- `../../platform/monitoring-alerting/SKILL.md` — observability
- `../../devops/devops-k8s-orchestration/SKILL.md` — deployment
