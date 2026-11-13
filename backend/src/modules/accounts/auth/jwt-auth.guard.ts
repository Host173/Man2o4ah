import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole } from '../schemas/user.schema.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_COOKIE,
  PASSWORD_CHANGE_ALLOW_LIST,
  SESSION_IDLE_MS,
  SESSION_SLIDE_INTERVAL_MS,
  TEMPORARY_PUBLIC_ROUTES,
} from './auth.constants.js';
import type {
  AccessTokenPayload,
  AuthenticatedRequest,
  AuthUser,
} from './auth.types.js';
import { IS_PUBLIC } from './decorators.js';

const ROLES: readonly string[] = Object.values(UserRole);

function unauthorized(code: ErrorCode, message: string) {
  return new UnauthorizedException({ code, message });
}

/**
 * Global authentication guard (auth.md §5), registered before `RolesGuard`.
 *
 * 1. `@Public()`: attaches the user if a valid cookie exists, always passes.
 * 2. No `access_token` cookie → 401 NOT_AUTHENTICATED.
 * 3. Bad or expired token → 401 TOKEN_EXPIRED (the frontend then refreshes).
 * 4. Session missing or idle for 30 minutes → 401 SESSION_EXPIRED; otherwise
 *    its activity slides (at most once a minute).
 * 5. `mustChangePassword` → 403 PASSWORD_CHANGE_REQUIRED outside the allow-list.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic || this.matches(TEMPORARY_PUBLIC_ROUTES, request)) {
      // Personalise public pages when possible; a bad cookie is just a guest.
      try {
        request.user = await this.authenticate(request);
      } catch {
        request.user = undefined;
      }
      return true;
    }

    request.user = await this.authenticate(request);
    return true;
  }

  private async authenticate(request: AuthenticatedRequest): Promise<AuthUser> {
    const token = this.readToken(request);
    const payload = await this.verify(token);
    const now = Date.now();

    const [session, user] = await Promise.all([
      this.sessionModel
        .findById(payload.sid, { userId: 1, expiresAt: 1 })
        .lean(),
      this.userModel.findById(payload.sub, { mustChangePassword: 1 }).lean(),
    ]);
    if (
      !session ||
      !user ||
      session.expiresAt.getTime() <= now ||
      session.userId.toString() !== payload.sub
    ) {
      throw unauthorized(
        ErrorCode.SessionExpired,
        'Your session has expired. Please log in again.',
      );
    }

    await this.slide(payload.sid, now);

    if (
      user.mustChangePassword &&
      !this.isAllowedDuringPasswordChange(request)
    ) {
      throw new ForbiddenException({
        code: ErrorCode.PasswordChangeRequired,
        message: 'You must change your password before continuing.',
      });
    }

    return {
      id: payload.sub,
      role: payload.role,
      sid: payload.sid,
      ...(payload.providerId ? { providerId: payload.providerId } : {}),
    };
  }

  private readToken(request: AuthenticatedRequest): string {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[ACCESS_TOKEN_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw unauthorized(ErrorCode.NotAuthenticated, 'Please log in.');
    }
    return token;
  }

  private async verify(token: string): Promise<AccessTokenPayload> {
    let payload: Partial<Record<keyof AccessTokenPayload, unknown>>;
    try {
      payload = await this.jwt.verifyAsync(token, {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
      });
    } catch {
      throw this.tokenExpired();
    }
    const { sub, role, sid, providerId } = payload;
    if (
      typeof sub !== 'string' ||
      !isValidObjectId(sub) ||
      typeof sid !== 'string' ||
      !isValidObjectId(sid) ||
      typeof role !== 'string' ||
      !ROLES.includes(role) ||
      (providerId !== undefined && typeof providerId !== 'string')
    ) {
      throw this.tokenExpired();
    }
    return {
      sub,
      sid,
      role: role as AccessTokenPayload['role'],
      ...(providerId ? { providerId } : {}),
    };
  }

  private tokenExpired() {
    return unauthorized(
      ErrorCode.TokenExpired,
      'Your access token is invalid or has expired.',
    );
  }

  /** Conditional, so parallel requests slide a session once per interval at most. */
  private async slide(sid: string, now: number): Promise<void> {
    await this.sessionModel.updateOne(
      {
        _id: sid,
        lastActivityAt: { $lt: new Date(now - SESSION_SLIDE_INTERVAL_MS) },
      },
      {
        $set: {
          lastActivityAt: new Date(now),
          expiresAt: new Date(now + SESSION_IDLE_MS),
        },
      },
    );
  }

  private isAllowedDuringPasswordChange(
    request: AuthenticatedRequest,
  ): boolean {
    return this.matches(PASSWORD_CHANGE_ALLOW_LIST, request);
  }

  /** Exact method + path match (a trailing slash is ignored). */
  private matches(
    routes: readonly { method: string; path: string }[],
    request: AuthenticatedRequest,
  ): boolean {
    const path = request.path.replace(/\/+$/, '');
    return routes.some(
      (route) => route.method === request.method && route.path === path,
    );
  }
}
