import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { Role } from './auth.types.js';
import type { AuthUser } from './auth.types.js';
import { Roles } from './decorators.js';
import { RolesGuard } from './roles.guard.js';

class Probe {
  open() {}
  @Roles(Role.ADMIN)
  adminOnly() {}
  @Roles(Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR)
  moderators() {}
}

@Roles(Role.ADMIN)
class AdminProbe {
  inherited() {}
  @Roles(Role.USER)
  overridden() {}
}

function contextFor(
  cls: new () => object,
  handler: string,
  user?: Partial<AuthUser>,
): ExecutionContext {
  const proto = cls.prototype as Record<string, unknown>;
  return {
    getHandler: () => proto[handler],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const asUser = (role: Role): AuthUser => ({ id: 'u-1', role, sid: 's-1' });

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return (error as { getResponse(): { code: string } }).getResponse().code;
  }
  return undefined;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(Object.values(Role))(
    'lets any logged-in %s through a route without @Roles',
    (role) => {
      expect(guard.canActivate(contextFor(Probe, 'open', asUser(role)))).toBe(
        true,
      );
    },
  );

  it('lets a listed role through', () => {
    expect(
      guard.canActivate(contextFor(Probe, 'adminOnly', asUser(Role.ADMIN))),
    ).toBe(true);
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'rejects %s on an admin route with 403 FORBIDDEN_ROLE',
    (role) => {
      const call = () =>
        guard.canActivate(contextFor(Probe, 'adminOnly', asUser(role)));
      expect(call).toThrow(ForbiddenException);
      expect(codeOf(call)).toBe(ErrorCode.ForbiddenRole);
    },
  );

  it('accepts every role of a multi-role list and nothing else', () => {
    for (const role of [Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR]) {
      expect(
        guard.canActivate(contextFor(Probe, 'moderators', asUser(role))),
      ).toBe(true);
    }
    expect(() =>
      guard.canActivate(contextFor(Probe, 'moderators', asUser(Role.ADMIN))),
    ).toThrow(ForbiddenException);
  });

  it('applies class-level @Roles, and a handler-level @Roles overrides it', () => {
    expect(
      guard.canActivate(
        contextFor(AdminProbe, 'inherited', asUser(Role.ADMIN)),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contextFor(AdminProbe, 'inherited', asUser(Role.USER))),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        contextFor(AdminProbe, 'overridden', asUser(Role.USER)),
      ),
    ).toBe(true);
  });

  it('rejects a guest on a role-limited route with 401 NOT_AUTHENTICATED', () => {
    const call = () => guard.canActivate(contextFor(Probe, 'adminOnly'));
    expect(call).toThrow(UnauthorizedException);
    expect(codeOf(call)).toBe(ErrorCode.NotAuthenticated);
  });
});
