import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { validationExceptionFactory } from './common/errors/validation-exception.factory.js';

/**
 * The wiring every request goes through: cookies, the `/api` prefix, the
 * validation pipe, the error filter, CORS and static `/uploads`.
 *
 * The app must be created with `{ rawBody: true }` (Stripe webhook signatures
 * need the raw request body). Tests call `configureApp` too, so they run with
 * the same wiring as production.
 */
export function configureApp(
  app: NestExpressApplication,
  options: { uploadDir: string; frontendUrl: string },
): void {
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: options.frontendUrl, credentials: true });

  mkdirSync(options.uploadDir, { recursive: true });
  app.useStaticAssets(resolve(options.uploadDir), { prefix: '/uploads/' });
}

/** Swagger UI at `/api/docs`; the cookie scheme lets Swagger send the login cookie. */
export function setupSwagger(app: INestApplication, version: string): void {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Travel Platform API')
    .setVersion(version)
    .addCookieAuth('access_token')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );
}
