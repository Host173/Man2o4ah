import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { createFullApp } from '../../support/full-app.js';
import type { FullApp } from '../../support/full-app.js';

export interface AuditApp extends FullApp {
  /** The document Swagger UI shows (`setupSwagger` in src/app.setup.ts). */
  openApi: () => OpenAPIObject;
}

/**
 * The whole app for the audit: every feature module of `app.module.ts`, real,
 * on the in-memory replica set. Only Stripe and the FX rates API are faked
 * (`createFullApp`), the reference data and one exchange-rate document are
 * seeded, and the demo world is built through the API.
 */
export async function createAuditApp(): Promise<AuditApp> {
  const full = await createFullApp();
  const openApi = (): OpenAPIObject =>
    SwaggerModule.createDocument(
      full.t.app,
      new DocumentBuilder()
        .setTitle('Travel Platform API')
        .setVersion('audit')
        .addCookieAuth('access_token')
        .build(),
    );
  return { ...full, openApi };
}

export interface RouteMeta {
  isPublic: boolean;
  roles: string[];
}

const VERBS = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'ALL',
  'OPTIONS',
  'HEAD',
];

function joinPath(...parts: string[]): string {
  const raw = parts
    .flatMap((p) => p.split('/'))
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith(':') ? `{${p.slice(1)}}` : p))
    .join('/');
  return `/${raw}`;
}

/**
 * `METHOD /api/path` (OpenAPI form) → whether the route is `@Public()` and
 * which `@Roles` it needs, read from the controllers' metadata.
 */
export function routeMeta(app: AuditApp): Map<string, RouteMeta> {
  const out = new Map<string, RouteMeta>();
  const container = (
    app.t.app as unknown as {
      container: {
        getModules: () => Map<
          string,
          { controllers: Map<unknown, { metatype: unknown }> }
        >;
      };
    }
  ).container;
  for (const mod of container.getModules().values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new () => object) | undefined;
      if (!cls) continue;
      const base = Reflect.getMetadata('path', cls) as string | string[];
      const bases = Array.isArray(base) ? base : [base ?? ''];
      const classPublic = Reflect.getMetadata('isPublic', cls) === true;
      const classRoles = (Reflect.getMetadata('roles', cls) as string[]) ?? [];
      const proto = cls.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const verb = Reflect.getMetadata('method', handler) as
          number | undefined;
        if (verb === undefined) continue;
        const sub = Reflect.getMetadata('path', handler) as string | string[];
        const subs = Array.isArray(sub) ? sub : [sub ?? ''];
        const meta: RouteMeta = {
          isPublic:
            Reflect.getMetadata('isPublic', handler) === true || classPublic,
          roles:
            (Reflect.getMetadata('roles', handler) as string[] | undefined) ??
            classRoles,
        };
        for (const b of bases)
          for (const s of subs)
            out.set(`${VERBS[verb]} ${joinPath('api', b, s)}`, meta);
      }
    }
  }
  return out;
}
