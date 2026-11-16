import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { AuthenticatedRequest, Role } from './auth.types.js';
import { ROLES } from './decorators.js';

/**
 * Global role guard, runs after `JwtAuthGuard` (auth.md §5). No `@Roles`
 * metadata: any logged-in account passes. Otherwise a role outside the list
 * gets 403 FORBIDDEN_ROLE. Ownership and moderator scope (ACC-11) are checked
 * in services, not here.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      // Only reachable on a @Public() route that also has @Roles: a guest.
      throw new UnauthorizedException({
        code: ErrorCode.NotAuthenticated,
        message: 'Please log in.',
      });
    }
    if (!roles.includes(user.role)) {
      throw new ForbiddenException({
        code: ErrorCode.ForbiddenRole,
        message: 'Your role is not allowed to do this.',
      });
    }
    return true;
  }
}
