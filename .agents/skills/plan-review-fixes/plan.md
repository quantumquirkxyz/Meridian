## Review Fix Plan

Status: planned
Review: `git diff main...HEAD` against PR (not yet opened; review trail: https://github.com/quantumquirkxyz/AgentTrading/issues/17#issuecomment-5297587999)

### Spec

- [ ] AC4 graph-state reconstruction is passthrough, not derived
  - Requirement: *"Replay can reconstruct graph state (per Alpha.2 exit criterion)"*
  - Finding: `reconstructGraphState` (replay.ts:57) only returns the latest pre-built `GRAPH_UPDATED` payload — trivial passthrough, not derived from market events. The AC4 test feeds only synthetic fully-formed snapshots.
  - Fix: Make `reconstructGraphState` the authoritative path and **not** used by the bus. Wire `foldGraphState` as the primary reconstruction path, and remove `reconstructGraphState` (which was unused by `replayAll`). Update the AC4 test to assert that replay + fold produces a deterministic graph from market events.
  - Validate: `bun test packages/events/test`

- [ ] sameEventStream skips payload comparison
  - Requirement: *"A recorded market session replays deterministically (identical event stream and order)"*
  - Finding: `sameEventStream` (replay.ts:33-49) compares eventId/sequence/type/kind/timestampMs/source but **not payload**. Two streams with identical metadata but different payloads are reported as "same."
  - Fix: Add payload comparison (via `JSON.stringify`) to `sameEventStream`. Also add a test: same eventId/type but different payload → `sameEventStream` returns `false`.
  - Validate: `bun test packages/events/test`

- [ ] nextSequence is not transaction-safe
  - Requirement: *"Events are published with idempotency keys and deduplicated"*
  - Finding: `nextSequence` (store.ts:91-94) does `MAX(sequence) + 1` outside any transaction/lock. Two concurrent appends can claim the same sequence, and the UNIQUE constraint would raise a UNIQUE violation rather than dedup.
  - Fix: Wrap append in a SQLite transaction (`db.transaction(...)`) to ensure atomicity of the SELECT+INSERT sequence. bun:sqlite supports `db.transaction()`.
  - Validate: `bun test packages/events/test`

### Standards

- [ ] Duplicated SELECT column list in store.ts
  - Finding: `packages/events/src/store.ts:74/78/82` repeat the identical `SELECT event_id AS eventId, sequence, type, kind, timestamp_ms AS timestampMs, source, payload` column list across three prepared statements.
  - Fix: Extract `const SELECT_COLUMNS = "event_id AS eventId, sequence, type, kind, timestamp_ms AS timestampMs, source, payload";` and interpolate into all three statements.
  - Validate: `bun run typecheck && bun test packages/events/test`

### Notes

- The `foldGraphState` function (replay.ts) is marked as scope creep in the review. It is not wired into any replay path. Two options: (a) remove it entirely, or (b) make it the primary AC4 reconstruction path by having `replayAll` return a `{ events, graphState }` result that calls `foldGraphState`. Option (b) satisfies AC4 more honestly but changes the replay API. Recommend option (b) during implementation.
- No PR exists yet. This plan is stored locally as `plan.md` and will be posted as a PR comment once the PR is opened via `publish-open-pr`.
