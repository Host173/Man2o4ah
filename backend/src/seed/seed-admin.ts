import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { parseAdminSeedInput } from '../modules/accounts/seed/admin-seed-input.js';
import { AdminSeedService } from '../modules/accounts/seed/admin-seed.service.js';
import { SeedModule } from './seed.module.js';

const app = await NestFactory.createApplicationContext(SeedModule);
try {
  const config = app.get(ConfigService);
  const input = parseAdminSeedInput({
    SEED_ADMIN_EMAIL: config.get<string>('SEED_ADMIN_EMAIL'),
    SEED_ADMIN_PASSWORD: config.get<string>('SEED_ADMIN_PASSWORD'),
  });
  await app.get(AdminSeedService, { strict: false }).run(input);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
