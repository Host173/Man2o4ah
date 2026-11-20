import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleMetadata } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../../src/app.setup.js';
import { EventsModule } from '../../src/common/events/events.module.js';
import { AccountsModule } from '../../src/modules/accounts/accounts.module.js';
import { startMemoryMongo } from './mongo-memory.js';
import { TEST_CONFIG } from './test-config.js';

export interface TestAppOptions {
  /** The module(s) under test, real. */
  imports?: ModuleMetadata['imports'];
  controllers?: ModuleMetadata['controllers'];
  providers?: ModuleMetadata['providers'];
  /** Fakes for other modules. */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export interface TestApp {
  app: NestExpressApplication;
  moduleRef: TestingModule;
  connection: Connection;
  /** `request(app.getHttpServer())` */
  http: () => ReturnType<typeof request>;
  /** The temporary directory served under `/uploads`; deleted by `close()`. */
  uploadDir: string;
  close: () => Promise<void>;
}

/**
 * Builds the production app wiring (`configureApp`, the global auth guards from
 * `AccountsModule`) around your module on a
 * one-node in-memory MongoDB replica set (transactions work), and waits for
 * every index. Tests never read `.env` and never touch Atlas.
 *
 * ```ts
 * let t: TestApp;
 * beforeAll(async () => {
 *   t = await createTestApp({ imports: [FlightsModule] });
 * }, HOOK_TIMEOUT);
 * afterAll(() => t.close(), HOOK_TIMEOUT);
 * ```
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestApp> {
  const mongo = await startMemoryMongo();
  const uploadDir = mkdtempSync(join(tmpdir(), 'test-uploads-'));
  let app: NestExpressApplication | undefined;
  try {
    let builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ ...TEST_CONFIG, UPLOAD_DIR: uploadDir })],
        }),
        MongooseModule.forRoot(mongo.uri, { dbName: 'test' }),
        EventEmitterModule.forRoot(),
        EventsModule,
        // The real global guards, as in production: routes need a login
        // (`loginAs`) unless they are `@Public()`.
        AccountsModule,
        ...(options.imports ?? []),
      ],
      controllers: options.controllers ?? [],
      providers: options.providers ?? [],
    });
    if (options.override) builder = options.override(builder);
    const moduleRef = await builder.compile();

    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app = nestApp;
    configureApp(nestApp, {
      uploadDir,
      frontendUrl: TEST_CONFIG.FRONTEND_URL,
    });
    await nestApp.init();

    const connection = moduleRef.get<Connection>(getConnectionToken());
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );

    return {
      app: nestApp,
      moduleRef,
      connection,
      http: () => request(nestApp.getHttpServer()),
      uploadDir,
      close: async () => {
        await nestApp.close();
        await mongo.stop();
        rmSync(uploadDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await app?.close();
    await mongo.stop();
    rmSync(uploadDir, { recursive: true, force: true });
    throw error;
  }
}
