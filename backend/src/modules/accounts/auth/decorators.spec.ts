import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from './auth.types.js';
import type { AuthUser } from './auth.types.js';
import {
  currentUserFrom,
  IS_PUBLIC,
  Public,
  ROLES,
  Roles,
} from './decorators.js';

class Probe {
  @Public()
  open() {}
  @Roles(Role.ADMIN, Role.USER)
  limited() {}
  plain() {}
}

/** The handler function itself, as Nest's `context.getHandler()` returns it. */
const handler = (name: keyof Probe) =>
  (Probe.prototype as unknown as Record<string, () => void>)[name]!;

describe('auth decorators', () => {
  const reflector = new Reflector();

  it('@Public() marks the handler public', () => {
    expect(reflector.get(IS_PUBLIC, handler('open'))).toBe(true);
    expect(reflector.get(IS_PUBLIC, handler('plain'))).toBeUndefined();
  });

  it('@Roles() stores the roles in order', () => {
    expect(reflector.get(ROLES, handler('limited'))).toEqual([
      Role.ADMIN,
      Role.USER,
    ]);
    expect(reflector.get(ROLES, handler('plain'))).toBeUndefined();
  });

  it('Role is the schema enum, with the four roles', () => {
    expect(Object.values(Role)).toEqual([
      'user',
      'admin',
      'airline_moderator',
      'hotel_moderator',
    ]);
  });

  const contextWith = (user?: AuthUser) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('@CurrentUser() returns the user the guard attached', () => {
    const user: AuthUser = {
      id: 'u-1',
      role: Role.HOTEL_MODERATOR,
      providerId: 'h-1',
      sid: 's-1',
    };
    expect(currentUserFrom(contextWith(user))).toBe(user);
  });

  it('@CurrentUser() is undefined for a guest', () => {
    expect(currentUserFrom(contextWith())).toBeUndefined();
  });
});
