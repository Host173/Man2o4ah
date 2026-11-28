import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { validate } from '../config/validate.js';
import { AccountsSeedModule } from '../modules/accounts/seed/accounts-seed.module.js';
import { ReferenceDataModule } from '../modules/reference-data/reference-data.module.js';

/** Minimal module for standalone seed scripts: config, connection, reference data, admin account (ACC-18). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ReferenceDataModule,
    AccountsSeedModule,
  ],
})
export class SeedModule {}
