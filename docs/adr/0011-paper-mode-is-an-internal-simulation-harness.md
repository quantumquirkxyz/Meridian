# ADR-0011: Paper Mode Is an Internal Simulation Harness

Status: Accepted

## Context

The repository needs a paper mode that can validate the end-to-end trading loop without consuming exchange credentials or live capital. Previous runs showed that paper mode can produce real audit events and session summaries, but the distinction between summary, promotion evidence, and venue integration was not explicit enough.

## Decision

Paper mode is defined as an internal simulation harness.

- It does not depend on Bybit demo trading or live trading credentials.
- It must validate the internal chain: market ingestion, opportunity detection, risk gating, simulated execution, reconciliation, and shutdown reporting.
- Its canonical session artifacts are `audit.jsonl` and `summary.json`.
- `evidence.json` is a promotion artifact used to decide whether the session qualifies for the next stage.
- Demo trading remains a separate mode and must not be treated as paper.

## Consequences

- Paper mode can be exercised safely and repeatedly without capital exposure.
- The simulation harness remains the primary place to validate control flow and fail-closed behavior.
- Any future demo mode must be implemented as a separate integration layer rather than a paper alias.
