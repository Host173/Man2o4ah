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
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { ActiveBookingsCheckRegistry } from './ports/active-bookings-check.registry.js';
import { Session, SessionSchema } from './schemas/session.schema.js';
import { User, UserSchema } from './schemas/user.schema.js';

/**
 * Accounts (CTR-01). Registers the global guards: every route needs a
 * logged-in account (the `access_token` cookie) unless it is `@Public()`;
 * Swagger and `/uploads` are served outside the guards. Needs
 * `JWT_ACCESS_SECRET` in the configuration. Other modules use the exported
 * `AccountsService` and `ActiveBookingsCheckRegistry`; tests use
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
  providers: [
    AccountsService,
    ActiveBookingsCheckRegistry,
    // Global, in this order: authentication first, then roles (auth.md §5).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AccountsService, ActiveBookingsCheckRegistry],
})
export class AccountsModule {}
