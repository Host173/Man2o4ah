import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { createDemoApi } from './demo/demo-api.js';
import { buildDemoPlan } from './demo/demo-plan.js';
import { runDemoSeed } from './demo/demo-seed.js';

// The seed is a client of the API: it needs no exchange-rate refresh.
process.env.FX_AUTO_REFRESH ??= 'false';

/**
 * PLT-08: fills the database with a small demo world through the app's own
 * HTTP API. Run after `seed:reference` and `seed:admin`; safe to re-run.
 * `--verbose` also prints one line per skipped item.
 */
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  rawBody: true,
});
try {
  const config = app.get(ConfigService);
  configureApp(app, {
    uploadDir: config.get<string>('UPLOAD_DIR', 'uploads'),
    frontendUrl: config.get<string>('FRONTEND_URL', 'http://localhost:3000'),
  });
  const plan = buildDemoPlan({
    password: config.get<string>('DEMO_PASSWORD'),
    adminEmail: config.get<string>('SEED_ADMIN_EMAIL'),
    adminPassword: config.get<string>('SEED_ADMIN_PASSWORD'),
    today: new Date().toISOString().slice(0, 10),
    verbose: process.argv.includes('--verbose'),
  });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const started = Date.now();
  await runDemoSeed(
    createDemoApi(`http://127.0.0.1:${port}/api`),
    plan,
    (line) => console.log(line),
  );
  console.log(`done in ${Math.round((Date.now() - started) / 1000)} s`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
