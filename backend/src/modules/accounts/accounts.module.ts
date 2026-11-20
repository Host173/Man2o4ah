import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsService } from './accounts.service.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_TTL_SECONDS,
} from './auth/auth.constants.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { RefreshAuthCookiesInterceptor } from './auth/refresh-auth-cookies.interceptor.js';
import { ActiveBookingsCheckRegistry } from './ports/active-bookings-check.registry.js';
import { Session, SessionSchema } from './schemas/session.schema.js';
import { User, UserSchema } from './schemas/user.schema.js';
import { ProfileService } from './users/profile.service.js';
import { SelfDeactivationService } from './users/self-deactivation.service.js';
import { UsersController } from './users/users.controller.js';

/**
 * Accounts (CTR-01). Registers the global guards: every route needs a
 * logged-in account (the `access_token` cookie) unless it is `@Public()`;
 * Swagger and `/uploads` are served outside the guards. Needs
 * `JWT_ACCESS_SECRET` in the configuration. `AuthController` serves
 * `/api/auth/*` (ACC-01 registration, ACC-04 login, ACC-06 refresh/logout,
 * ACC-08 change password, ACC-19 current user)
 * and `UsersController` serves `/api/users/me` (ACC-09 profile; supported
 * currencies come from `ReferenceDataService`, looked up from the app, so
 * `ReferenceDataModule` must be registered beside this module; ACC-12
 * self-deactivation); `AuthService` and
 * `SelfDeactivationService` stay internal. Other
 * modules use the exported `AccountsService` and
 * `ActiveBookingsCheckRegistry`. ITN-18 also reads the preferred currency
 * through the exported `ProfileService`; tests use
 * `FakeAccountsService`, `FakeActiveBookingsCheck` and `loginAs`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: ACCESS_TOKEN_ALGORITHM,
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    AccountsService,
    AuthService,
    ProfileService,
    SelfDeactivationService,
    RefreshAuthCookiesInterceptor,
    ActiveBookingsCheckRegistry,
    // Global, in this order: authentication first, then roles (auth.md §5).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // ProfileService is exported for ITN-18's read of the ACC-09 preferred
  // currency; it stays otherwise internal (GET/PATCH /users/me use it).
  exports: [AccountsService, ActiveBookingsCheckRegistry, ProfileService],
})
export class AccountsModule {}
