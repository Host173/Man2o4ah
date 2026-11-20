import { vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AccountsModule } from '../accounts.module.js';
import { ActiveBookingsCheckRegistry } from '../ports/active-bookings-check.registry.js';
import { Session } from '../schemas/session.schema.js';
import { User } from '../schemas/user.schema.js';
import { SelfDeactivationService } from './self-deactivation.service.js';

describe('SelfDeactivationService wiring (ACC-12)', () => {
  it('compiles AccountsModule without EventsModule, as modules importing accounts do in their tests', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AccountsModule],
    })
      .useMocker((token) => {
        if (token === getConnectionToken()) return {};
        if (token === ConfigService) {
          return { getOrThrow: () => 'test-secret-with-at-least-32-chars' };
        }
        return undefined;
      })
      .overrideProvider(getModelToken(User.name))
      .useValue({})
      .overrideProvider(getModelToken(Session.name))
      .useValue({})
      .compile();

    const service = moduleRef.get(SelfDeactivationService);
    expect(service).toBeInstanceOf(SelfDeactivationService);

    // Without EventsModule nothing may change: it fails before the booking check.
    const registry = moduleRef.get(ActiveBookingsCheckRegistry);
    const check = vi.spyOn(registry, 'hasUpcomingConfirmed');
    await expect(service.deactivate('u-1')).rejects.toThrow(/AppEvents/);
    expect(check).not.toHaveBeenCalled();
  });
});
