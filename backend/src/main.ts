import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp, setupSwagger } from './app.setup.js';
import dns from 'node:dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  configureApp(app, {
    uploadDir: config.get<string>('UPLOAD_DIR', 'uploads'),
    frontendUrl: config.get<string>('FRONTEND_URL', 'http://localhost:3000'),
  });

  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
  ) as { version: string };
  setupSwagger(app, version);

  await app.listen(config.get<number>('PORT', 4000));
}
await bootstrap();
