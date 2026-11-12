import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PayloadOf } from './event-payloads.js';
import type { EventName } from './events.js';

/**
 * The only way to emit an event. Emit after the transaction commits. Never
 * use a string literal or `EventEmitter2` directly: `Events.X` and its
 * payload type keep every emitter and handler in step.
 */
@Injectable()
export class AppEvents {
  constructor(private readonly emitter: EventEmitter2) {}

  emit<K extends EventName>(name: K, payload: PayloadOf<K>): void {
    this.emitter.emit(name, payload);
  }
}
