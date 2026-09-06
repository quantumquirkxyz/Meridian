---
name: data-etl-pipeline
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design ETL / ELT pipelines — extraction, transformation, load — with reproducible steps, schema evolution, quality checks, and observability.
capabilities:
  - design extraction from sources (database, API, file, stream)
  - define transformations (filter, aggregate, join, enrich, clean, deduplicate)
  - design load into target (warehouse, lake, database)
  - implement quality checks (null rate, out-of-range, duplicates, referential integrity)
outputs:
  - Pipeline architecture (diagram + configuration)
  - Data quality rules and checks
  - Schema evolution plan
sideEffects: []
dependencies: []
stopCondition: Pipeline architecture saved; quality rules defined; schema evolution plan present.
risk: medium
trustTier: 3
maxIterations: 6
---

## Contract

- **Input:** source data descriptions, target schema, quality requirements.
- **Output:** pipeline architecture + quality rules + schema evolution.
- **Side effects:** may process data when executed (read-only or write to target).
- **Dependencies:** source access, target access.
- **Stop condition:** architecture saved; quality rules defined.
- **Risk:** medium — data corruption risks; requires testing.
- **Boundary:** defines pipeline; execution requires approval.

# ETL Pipeline Design

Design an **ETL / ELT pipeline** — extraction, transformation, load — with reproducible steps, schema evolution, and data quality checks.

## Process

### 1. Source analysis
- Source type: database (SQL / NoSQL), file (CSV / JSON / Parquet / ORC), API (REST / GraphQL / gRPC), stream (Kafka / Kinesis / Pub/Sub).
- Schema: columns, types, constraints.
- Frequency: batch (hourly / daily) or streaming (near real-time).
- Volume: rows / GB per run.
- Quality issues: missing values, out-of-range, duplicates, format errors.

**Completion criterion:** source profile saved.

### 2. Transformation design
- Filter: remove rows that don't meet criteria.
- Clean: fix types, trim whitespace, standardise formats.
- Aggregate: group by key, compute statistics.
- Enrich: join with reference data (customer, product, geography).
- Deduplicate: exact / fuzzy / probabilistic.

**Completion criterion:** transformation steps documented.

### 3. Load design
- Target type: warehouse (Snowflake / BigQuery / Redshift / Databricks) vs database vs lake.
- Load strategy: full refresh (replace all) / incremental (append new / update changed) / merge (upsert).
- Partition / clustering strategy for performance.
- Backfill plan for historical data.

**Completion criterion:** load strategy saved.

### 4. Data quality
- Null rate per column (threshold: < X%).
- Out-of-range checks (min / max / expected range).
- Duplicate rate.
- Referential integrity (foreign key consistency).
- Freshness (data delay from source to target).

**Completion criterion:** quality rules saved with thresholds and actions (fail / warn / fix).

### 5. Schema evolution
- How to handle new columns (add, ignore, raise error).
- How to handle renamed / deleted columns.
- Versioning: schema registry (e.g. Confluent Schema Registry, AWS Glue Data Catalog).

**Completion criterion:** evolution plan saved.
