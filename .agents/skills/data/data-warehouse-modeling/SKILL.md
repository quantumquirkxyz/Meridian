---
name: data-warehouse-modeling
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Design analytical warehouse schemas — star / snowflake / OBT — with dimension, fact, and bridge tables; partitioning; indexing; and query optimization.
capabilities:
  - design star / snowflake / OBT schemas for analytical workloads
  - define dimensions (time, geography, product, customer) and facts (events, transactions)
  - design partitioning (by date, region, category) and clustering
  - optimise queries (materialised views, indexes, partition pruning)
outputs:
  - Schema diagram (ASCII / Mermaid / diagram)
  - Dimension and fact definitions
  - Query optimisation notes
sideEffects: []
dependencies: []
stopCondition: Schema design saved; dimensions and facts defined; optimisation notes present.
risk: low
trustTier: 1
maxIterations: 5
---

## Contract

- **Input:** source data descriptions, analytical questions, query patterns.
- **Output:** warehouse schema design + query optimisation notes.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** schema saved; dimensions/facts defined.
- **Risk:** low.
- **Boundary:** designs schema; does not create warehouse resources.

# Data Warehouse Modeling

Design an **analytical warehouse schema** — star / snowflake / OBT — with dimensions, facts, and query optimisation.

## Process

### 1. Identify analytical questions
- What questions must be answered? (revenue by region/month/product, customer lifetime value, conversion funnel, inventory turnover)
- What metrics? (sum, count, average, rate, ratio)
- What filter dimensions? (date, region, product category, customer segment)

**Completion criterion:** questions saved.

### 2. Design dimensions
- **Time:** date, month, quarter, year, fiscal period; hierarchies (year → quarter → month → day).
- **Geography:** country, state, city, zip; hierarchies.
- **Product:** category, subcategory, brand, SKU; hierarchies.
- **Customer:** segment, tier, acquisition channel, lifetime value band.
- **Other:** promotion, channel, device, experiment group.

**Completion criterion:** dimensions with hierarchies saved.

### 3. Design facts
- **Transactional:** order events, transaction records, attendance, usage logs.
- **Snapshot:** daily balances, inventory levels, account states.
- **Aggregate:** pre-computed summaries for fast queries (if needed).

**Completion criterion:** facts with grain (one row per event / per day / per customer per day) saved.

### 4. Schema layout
- **Star:** dimensions directly connect to fact; simple; fast for common queries.
- **Snowflake:** dimensions normalised (e.g. product category → subcategory → brand → SKU as separate tables); saves storage; more joins.
- **OBT (One Big Table):** flatten everything into one wide table; fastest queries; may require more storage and maintenance.

**Completion criterion:** layout selected with justification.

### 5. Indexing and partitioning
- **Partitioning:** by date (most common), region, category; use time-based for rolling windows.
- **Clustering:** by frequently-filtered columns (e.g. region + product).
- **Materialised views:** for slow aggregates (monthly revenue, quarterly trends).
- **Indexes:** primary keys, foreign keys, frequently queried columns.

**Completion criterion:** optimisation notes saved.
