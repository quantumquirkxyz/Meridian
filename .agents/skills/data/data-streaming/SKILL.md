---
name: data-streaming
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design streaming data pipelines — Kafka, Kinesis, Pub/Sub, Flink — with event schemas, stream processing, and real-time analytics.
capabilities:
  - design event schemas and stream topology
  - configure producers / consumers / stream processors
  - handle backpressure, ordering, exactly-once semantics
  - design real-time analytics and alerting
outputs:
  - Stream topology diagram
  - Event schema (Avro / Protobuf / JSON Schema)
  - Processing rules and backpressure plan
sideEffects: []
dependencies: []
stopCondition: Topology diagram saved; event schema defined; processing rules documented.
risk: medium
trustTier: 3
maxIterations: 5
---

## Contract

- **Input:** stream source descriptions, processing requirements, latency/throughput targets.
- **Output:** topology design + event schema + processing rules.
- **Side effects:** may deploy stream resources when executed.
- **Dependencies:** streaming platform access (Kafka / Kinesis / Pub/Sub / Flink).
- **Stop condition:** design saved; rules documented.
- **Risk:** medium — stream errors propagate quickly; requires testing.
- **Boundary:** designs stream; executes only with explicit approval.

# Streaming Pipeline Design

Design a **streaming pipeline** — event producers, stream processors, consumers — with schema, processing rules, and reliability.

## Process

### 1. Source analysis
- Event sources: user actions, sensors, logs, transactions, external APIs.
- Event rate (events/sec), burst rate, volume (GB/day).
- Event schema: fields, types, optional/required, nesting.

**Completion criterion:** source profile saved.

### 2. Event schema
- Define Avro / Protobuf / JSON Schema.
- Versioning: schema registry (Confluent Schema Registry / AWS Glue / GCP Pub/Sub schema).
- Backward/forward compatibility rules.

**Completion criterion:** schema saved; versioning rules defined.

### 3. Stream topology
- **Producers:** service A, B, C; publish to topic/stream.
- **Stream:** partitioned by key (e.g. user_id, device_id) for parallel processing.
- **Processors:** stream jobs (Flink / Kafka Streams / Spark Streaming / Kinesis Analytics) — filter, aggregate, enrich, transform.
- **Consumers:** service D reads results; may write to database / cache / warehouse.

**Completion criterion:** topology diagram saved.

### 4. Processing rules
- Windowing: tumbling, sliding, session, custom.
- Aggregation: count, sum, average, max, min; with watermarks.
- Enrichment: join with reference data (stream or database lookup).
- Exactly-once / at-least-once / at-most-once semantics per use case.
- Backpressure: when downstream is slow, how to handle (drop old, throttle, buffer with limit).

**Completion criterion:** rules saved.

### 5. Reliability
- Replication: stream replicas across zones.
- Retention: data retention period; archive to storage for long-term.
- Monitoring: lag per partition; error rate; throughput; processing latency.
- Alert: lag > threshold; error rate > threshold; partition unassigned.

**Completion criterion:** reliability rules saved.
