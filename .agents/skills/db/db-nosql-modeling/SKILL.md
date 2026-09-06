---
name: db-nosql-modeling
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design NoSQL data models — document, key-value, wide-column, graph, time-series — with access pattern analysis, consistency requirements, and schema evolution.
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


# NoSQL Data Modeling

Design a **NoSQL data model** — document, key-value, wide-column, graph, time-series — with access pattern analysis and consistency trade-offs.

## When to use

- A domain naturally fits a NoSQL store (events, social graph, time-series, cache).
- Relational schema has been over-normalised for the read/write pattern.
- Scalability requirements push past a single RDBMS instance.

## Process

1. Identify access patterns — reads (by key, range, full-text, graph traversal) and writes (append, upsert, batch); frequency and latency requirements.
2. Choose NoSQL type:
   - Document (MongoDB, Couchbase): nested JSON, flexible schema.
   - Key-value (Redis, DynamoDB): simple get/put by key.
   - Wide-column (Cassandra, ScyllaDB): time-series, high-write throughput.
   - Graph (Neo4j, DynamoDB GSI): many-to-many, traversals.
   - Time-series (InfluxDB, TimescaleDB): metric ingestion, downsampling.
3. Design data layout — document structure, key design (partition + sort), column families, graph topology.
4. Consistency model — strong vs eventual; how does this affect correctness of reads?
5. Schema evolution — how are new fields / relationships added without downtime?
6. Scalability — partition/shard key; replication factor; read replicas;