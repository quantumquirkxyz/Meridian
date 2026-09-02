# 0006 — SQLite via `bun:sqlite` for persistence; in-memory event bus

## Status

Accepted

## Context

The system needs to persist structured data: event stores, audit trails, trade journals, agent observations, and reconciliation reports. These are all local, structured, relational data that need ACID transactions. The system currently runs as a single process (CLI), so there is no multi-process or distributed requirement.

The event bus (inter-module communication) needs to be fast and simple. There is no current requirement for message durability, replay, or multi-consumer patterns.

## Decision

**Persistence:** SQLite via `bun:sqlite` (embedded, zero infrastructure). The `storage` package provides a `SqliteEventStore` with typed schemas, WAL mode, and transaction support. Graph state, risk state, and configuration are serialized to SQLite tables.

**Event bus:** In-memory pub/sub. Modules communicate through a `Bus` class that publishes events synchronously within a single process. No external broker.

## Options considered

1. **SQLite via `bun:sqlite`** — zero dependencies, embedded, ACID, WAL mode for concurrent reads. Sufficient for single-process operation. Weakness: no multi-process access.

2. **PostgreSQL (external)** — production-grade, multi-process capable, rich query support. Overkill for a single-process CLI tool. Adds deployment complexity (connection strings, migrations, hosting).

3. **Redis Streams** — durable message bus, consumer groups, replay. Adds infrastructure dependency. Only justified if multi-process event consumption appears.

4. **Kafka / NATS** — distributed streaming. Massively over-scaled for current needs. Would be evaluated if the system scales to multi-venue, multi-process operation.

## Consequences

- **Zero infrastructure:** No database server, no Docker, no cloud dependency. The system runs with a single `bun` binary.
- **ACID transactions:** Audit trail and event store are consistent even on crashes. WAL mode allows concurrent reads during writes.
- **Single-process limitation:** If the system ever needs multiple processes (e.g., separate execution and monitoring), SQLite will not work for shared state. At that point, the event bus should be upgraded to Redis Streams or NATS, and persistent storage should move to PostgreSQL.
- **Data locality:** All data lives in local SQLite files under `storage/`. Backups are file copies. No network I/O for persistence.
- **Event bus is non-durable:** In-memory events are lost on process restart. This is acceptable because the event store (SQLite) is the durable record, and the bus is only for intra-process communication.
