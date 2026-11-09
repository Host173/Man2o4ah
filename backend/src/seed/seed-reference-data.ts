import { NestFactory } from '@nestjs/core';
import { SeedModule } from './seed.module.js';
import { ReferenceDataSeedService } from '../modules/reference-data/seed/reference-data-seed.service.js';

const app = await NestFactory.createApplicationContext(SeedModule);
try {
  await app.get(ReferenceDataSeedService, { strict: false }).run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
