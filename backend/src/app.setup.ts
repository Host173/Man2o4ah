import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { notFoundOutsidePrefix } from './common/errors/not-found-outside-prefix.js';
import { validationExceptionFactory } from './common/errors/validation-exception.factory.js';
import { rejectDeepBodies } from './common/http/body-depth.js';

/**
 * The wiring every request goes through: cookies, the `/api` prefix, the
 * validation pipe, the error filter, CORS, static `/uploads` and a JSON 404
 * for every other path outside `/api`.
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
  // Parse JSON here (Nest then skips its own jsonParser) so the depth check runs right after it,
  // before guards and pipes. Same parser and 100 kb limit as Nest's default; rawBody kept.
  app.useBodyParser('json');
  app.use(rejectDeepBodies);

  mkdirSync(options.uploadDir, { recursive: true });
  app.useStaticAssets(resolve(options.uploadDir), { prefix: '/uploads/' });

  // Must stay the last line: Nest only answers unknown paths under `/api`, so
  // anything else nothing served would get Express's HTML 404.
  app.use(notFoundOutsidePrefix('api'));
}

/**
 * The OpenAPI document Swagger UI shows. `npm run openapi:export` writes it to
 * `docs/api/openapi.json`.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  version: string,
): OpenAPIObject {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Travel Platform API')
    .setVersion(version)
    .addCookieAuth('access_token')
    .build();
  return orderPathParamsFirst(SwaggerModule.createDocument(app, swaggerConfig));
}

type DocParameter = { in?: string; name?: string };

/**
 * Path parameters first, in URL order, then the others as listed. The order
 * Swagger reads from decorator metadata depends on the compiler (`nest build`
 * lists `{id}` first, Vitest last), so the exported file and `/api/docs-json`
 * would differ without it. The production build already uses this order.
 */
function orderPathParamsFirst(doc: OpenAPIObject): OpenAPIObject {
  for (const [path, item] of Object.entries(doc.paths)) {
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const operation of Object.values(item) as {
      parameters?: DocParameter[];
    }[]) {
      const params = operation?.parameters;
      if (!Array.isArray(params)) continue;
      const rank = (p: DocParameter) =>
        p.in === 'path' && p.name !== undefined && names.includes(p.name)
          ? names.indexOf(p.name)
          : names.length;
      operation.parameters = params
        .map((p, index) => ({ p, index }))
        .sort((a, b) => rank(a.p) - rank(b.p) || a.index - b.index)
        .map(({ p }) => p);
    }
  }
  return doc;
}

/** Swagger UI at `/api/docs`; the cookie scheme lets Swagger send the login cookie. */
export function setupSwagger(app: INestApplication, version: string): void {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app, version));
}
