# 0006 — SQLite (bun:sqlite) as the only persistence in Alpha/Beta; in-memory bus

We persist the event store, audit, and trade journal in **SQLite via `bun:sqlite`** during Alpha and Beta (zero infrastructure, local transactions). The **event bus is in-memory**; Redis Streams / NATS / Kafka are evaluated only in Gamma if volume or multi-process appears. Graph state, risk state, and configuration are serialized to disk.
