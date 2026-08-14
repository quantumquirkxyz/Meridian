import { Database } from "bun:sqlite";
import {
  isEventEnvelope,
  type BaseEventType,
  type EventEnvelope,
  type EventKind,
  parseEventEnvelope,
} from "@agenttrading/contracts";

/**
 * SQLite event store (bun:sqlite, ADR-0006). Persists every published event —
 * raw and normalized — keyed by its idempotency key (`eventId`). The store is
 * the durable frontier between the in-memory bus and deterministic replay:
 * replay reads events back in the exact sequence they were appended.
 */

export interface PublishEvent {
  /** Idempotency key. Publishing the same key twice is a no-op. */
  eventId: string;
  type: BaseEventType;
  kind: EventKind;
  timestampMs: number;
  source: string;
  payload: Record<string, unknown>;
}

export interface AppendResult {
  event: EventEnvelope;
  /** True when the eventId was already present (deduplicated). */
  deduplicated: boolean;
}

interface Row {
  eventId: string;
  sequence: number;
  type: BaseEventType;
  kind: EventKind;
  timestampMs: number;
  source: string;
  payload: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  event_id   TEXT PRIMARY KEY,
  sequence   INTEGER NOT NULL UNIQUE,
  type       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  source     TEXT NOT NULL,
  payload    TEXT NOT NULL
);
`;

const SELECT_COLUMNS =
  "event_id AS eventId, sequence, type, kind, timestamp_ms AS timestampMs, source, payload";

export class EventStore {
  readonly db: Database;
  private readonly insertStmt: ReturnType<Database["query"]>;
  private readonly selectByEventIdStmt: ReturnType<Database["query"]>;
  private readonly selectBySequenceStmt: ReturnType<Database["query"]>;
  private readonly selectSinceStmt: ReturnType<Database["query"]>;
  private readonly maxSequenceStmt: ReturnType<Database["query"]>;
  private readonly countStmt: ReturnType<Database["query"]>;

  /** `path` may be a file path or ":memory:". */
  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
    this.insertStmt = this.db.query(
      `INSERT OR IGNORE INTO events
         (event_id, sequence, type, kind, timestamp_ms, source, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectByEventIdStmt = this.db.query(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE event_id = ?`,
    );
    this.selectBySequenceStmt = this.db.query(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE sequence = ?`,
    );
    this.selectSinceStmt = this.db.query(
      `SELECT ${SELECT_COLUMNS} FROM events WHERE sequence > ? ORDER BY sequence ASC`,
    );
    this.maxSequenceStmt = this.db.query(
      `SELECT COALESCE(MAX(sequence), 0) AS maxSeq FROM events`,
    );
    this.countStmt = this.db.query(`SELECT COUNT(*) AS count FROM events`);
  }

  private nextSequence(): number {
    const row = this.maxSequenceStmt.get() as { maxSeq: number };
    return row.maxSeq + 1;
  }

  private toEnvelope(row: Row): EventEnvelope {
    return {
      eventId: row.eventId,
      sequence: row.sequence,
      type: row.type,
      kind: row.kind,
      timestampMs: row.timestampMs,
      source: row.source,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    };
  }

  /**
   * Appends the event with the next monotonic sequence number. When an event
   * with the same `eventId` already exists it is deduplicated: nothing is
   * written and the stored event is returned instead (issue #17 AC1).
   *
   * The read-check-select is wrapped in a SQLite transaction so concurrent
   * appends cannot claim the same sequence number.
   */
  append(input: PublishEvent): AppendResult {
    const appendTx = this.db.transaction(() => {
      const existing = this.selectByEventIdStmt.get(input.eventId) as Row | null;
      if (existing) {
        return { event: this.toEnvelope(existing), deduplicated: true } as const;
      }
      const sequence = this.nextSequence();
      this.insertStmt.run(
        input.eventId,
        sequence,
        input.type,
        input.kind,
        input.timestampMs,
        input.source,
        JSON.stringify(input.payload),
      );
      const row = this.selectBySequenceStmt.get(sequence) as Row;
      return { event: this.toEnvelope(row), deduplicated: false } as const;
    });
    return appendTx();
  }

  /** True when an event with this idempotency key is already persisted. */
  has(eventId: string): boolean {
    return this.selectByEventIdStmt.get(eventId) !== null;
  }

  /** The event with the given idempotency key, or undefined. */
  byEventId(eventId: string): EventEnvelope | undefined {
    const row = this.selectByEventIdStmt.get(eventId) as Row | null;
    return row === null ? undefined : this.toEnvelope(row);
  }

  /** Every event in append (sequence) order. */
  all(): EventEnvelope[] {
    const rows = this.selectSinceStmt.all(0) as Row[];
    return rows.map((row) => this.toEnvelope(row));
  }

  /** Events appended after the given sequence, in sequence order. */
  since(sequence: number): EventEnvelope[] {
    const rows = this.selectSinceStmt.all(sequence) as Row[];
    return rows.map((row) => this.toEnvelope(row));
  }

  /** Number of persisted events. */
  count(): number {
    const row = this.countStmt.get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}

/** Re-exports the envelope validator for consumers of the store. */
export { isEventEnvelope, parseEventEnvelope };
