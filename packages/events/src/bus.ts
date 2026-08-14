import {
  type BaseEventType,
  type EventEnvelope,
} from "@agenttrading/contracts";
import { type AppendResult, EventStore, type PublishEvent } from "./store.ts";

export type EventHandler = (event: EventEnvelope) => void;

/**
 * In-memory event bus (ADR-0006). Publishes flow through an EventStore, which
 * assigns the monotonic sequence and deduplicates by idempotency key, so every
 * published event is durably recorded and deterministically replayable.
 * Subscribers are invoked synchronously, in subscription order, only for
 * non-duplicate events.
 */
export class EventBus {
  readonly store: EventStore;
  private readonly handlers = new Map<BaseEventType, EventHandler[]>();

  constructor(store?: EventStore) {
    this.store = store ?? new EventStore();
  }

  /**
   * Publishes an event. Returns the stored event (with its assigned sequence)
   * and whether it was a duplicate. Duplicate `eventId`s are not dispatched.
   */
  publish(input: PublishEvent): AppendResult {
    const result = this.store.append(input);
    if (!result.deduplicated) {
      for (const handler of this.handlers.get(input.type) ?? []) {
        handler(result.event);
      }
    }
    return result;
  }

  /** Registers a handler for one event type; returns an unsubscribe function. */
  subscribe(type: BaseEventType, handler: EventHandler): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => {
      const current = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        current.filter((candidate) => candidate !== handler),
      );
    };
  }

  /** Number of events persisted so far. */
  count(): number {
    return this.store.count();
  }

  /** Every recorded event in sequence order. */
  all(): readonly EventEnvelope[] {
    return this.store.all();
  }

  /** Events recorded after the given sequence, in sequence order. */
  since(sequence: number): readonly EventEnvelope[] {
    return this.store.since(sequence);
  }
}
