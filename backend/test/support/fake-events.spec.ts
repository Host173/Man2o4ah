import { Events } from '../../src/common/events/events.js';
import { FakeEvents } from './fake-events.js';

describe('FakeEvents', () => {
  it('records every emit in order', () => {
    const fake = new FakeEvents();
    const cancelled = { flightId: 'f-1' };
    const user = { userId: 'u-1' };
    fake.emit(Events.FlightCancelled, cancelled);
    fake.emit(Events.UserDeactivated, user);
    expect(fake.emitted).toEqual([
      { name: 'flight.cancelled', payload: cancelled },
      { name: 'user.deactivated', payload: user },
    ]);
  });

  it('filters payloads by event name', () => {
    const fake = new FakeEvents();
    fake.emit(Events.FlightCancelled, { flightId: 'f-1' });
    fake.emit(Events.UserDeactivated, { userId: 'u-1' });
    fake.emit(Events.FlightCancelled, { flightId: 'f-2' });
    expect(fake.payloadsOf(Events.FlightCancelled)).toEqual([
      { flightId: 'f-1' },
      { flightId: 'f-2' },
    ]);
    expect(fake.payloadsOf(Events.AccountSuspended)).toEqual([]);
  });

  it('forgets everything on clear()', () => {
    const fake = new FakeEvents();
    fake.emit(Events.FlightCancelled, { flightId: 'f-1' });
    fake.clear();
    expect(fake.emitted).toEqual([]);
    expect(fake.payloadsOf(Events.FlightCancelled)).toEqual([]);
  });
});
