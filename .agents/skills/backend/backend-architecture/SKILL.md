# backend-architecture

Shape backend systems — REST/gRPC APIs, service contracts, data flow, state management, error handling — with explicit seams and caller responsibilities.

## Goals
- Design small, durable API seams
- Define request/response contracts explicitly
- Separate business logic from transport layer
- Plan for versioning and backward compatibility

## Contract

### Input
A description of the backend problem: service type, data model, integration points.

### Output
A backend architecture design with:
- API endpoints and contracts
- Data flow diagram
- Error handling strategy
- Service boundaries

## Steps

1. **Identify the domain model** — entities, aggregates, value objects
2. **Define API contracts** — request/response shapes, HTTP methods, status codes
3. **Choose transport protocol** — REST, gRPC, GraphQL, WebSocket
4. **Design service seams** — internal modules, data access layer
5. **Plan error handling** — typed errors, retry logic, circuit breakers
6. **Document the architecture** — ADR or README with diagrams

## References
- `../api-design/SKILL.md` — API seam design
- `../api-contracts/SKILL.md` — contract versioning
- `../../platform/postgres/SKILL.md` — data persistence
