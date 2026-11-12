import type {
  EventPayloads,
  PayloadOf,
} from '../../src/common/events/event-payloads.js';
import type { EventName } from '../../src/common/events/events.js';

/** One recorded emit: the event name and the exact payload. */
export type EmittedEvent = {
  [K in EventName]: { name: K; payload: EventPayloads[K] };
}[EventName];

/**
 * Stands in for `AppEvents` in tests and records what was emitted:
 * `override: (b) => b.overrideProvider(AppEvents).useValue(fake)`.
 */
export class FakeEvents {
  readonly emitted: EmittedEvent[] = [];

  emit<K extends EventName>(name: K, payload: PayloadOf<K>): void {
    this.emitted.push({ name, payload } as EmittedEvent);
  }

  /** The payloads emitted under `name`, in emit order. */
  payloadsOf<K extends EventName>(name: K): PayloadOf<K>[] {
    return this.emitted
      .filter((event) => event.name === name)
      .map((event) => event.payload as PayloadOf<K>);
  }

  clear(): void {
    this.emitted.length = 0;
  }
}
