import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { validate } from './config/validate.js';
import { HealthModule } from './health/health.module.js';
import { ReferenceDataModule } from './modules/reference-data/reference-data.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    HealthModule,
    ReferenceDataModule,
    AccountsModule,
  ],
})
export class AppModule {}
