import { Injectable } from '@nestjs/common';
import { EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppEvents } from './app-events.service.js';
import type { PayloadOf } from './event-payloads.js';
import { Events } from './events.js';
import { EventsModule } from './events.module.js';

@Injectable()
class Listener {
  cancelled: PayloadOf<typeof Events.FlightCancelled>[] = [];
  rescheduled: PayloadOf<typeof Events.FlightRescheduled>[] = [];

  @OnEvent(Events.FlightCancelled)
  onCancelled(payload: PayloadOf<typeof Events.FlightCancelled>): void {
    this.cancelled.push(payload);
  }

  @OnEvent(Events.FlightRescheduled)
  onRescheduled(payload: PayloadOf<typeof Events.FlightRescheduled>): void {
    this.rescheduled.push(payload);
  }
}

describe('AppEvents', () => {
  let moduleRef: TestingModule;
  let events: AppEvents;
  let listener: Listener;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), EventsModule],
      providers: [Listener],
    }).compile();
    await moduleRef.init();
    events = moduleRef.get(AppEvents);
    listener = moduleRef.get(Listener);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('delivers the exact payload to the listener of that event only', () => {
    const payload = { flightId: 'f-1' };
    events.emit(Events.FlightCancelled, payload);
    expect(listener.cancelled).toEqual([payload]);
    expect(listener.cancelled[0]).toBe(payload);
    expect(listener.rescheduled).toEqual([]);
  });
});
