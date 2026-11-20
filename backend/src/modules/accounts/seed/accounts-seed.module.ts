import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../schemas/user.schema.js';
import { AdminSeedService } from './admin-seed.service.js';

/**
 * Accounts' part of the standalone seed scripts (ACC-18): only the `users`
 * model and `AdminSeedService`, without the JWT module, guards or
 * controllers of `AccountsModule`. Imported by `SeedModule`, never by
 * `AppModule`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [AdminSeedService],
  exports: [AdminSeedService],
})
export class AccountsSeedModule {}
