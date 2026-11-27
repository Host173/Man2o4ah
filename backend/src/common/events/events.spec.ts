import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  EventPayloads,
  FlightCancelledEvent,
  PayloadOf,
} from './event-payloads.js';
import { Events } from './events.js';
import type { EventName } from './events.js';

describe('Events', () => {
  const values = Object.values(Events);

  it('has exactly 19 events', () => {
    expect(Object.keys(Events)).toHaveLength(19);
  });

  it('has unique values', () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it('names every event `subject.verb`', () => {
    for (const value of values) {
      expect(value).toMatch(/^[a-z-]+\.[a-z-]+$/);
    }
  });

  it('has a payload type for every event, and no extra ones', () => {
    expectTypeOf<Exclude<EventName, keyof EventPayloads>>().toBeNever();
    expectTypeOf<Exclude<keyof EventPayloads, EventName>>().toBeNever();
  });

  it('maps an event name to its payload type', () => {
    expectTypeOf<
      PayloadOf<typeof Events.FlightCancelled>
    >().toEqualTypeOf<FlightCancelledEvent>();
  });
});
