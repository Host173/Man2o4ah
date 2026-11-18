import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeReportableContent } from '../../../test/fakes/reportable-content.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ModerationModule } from './moderation.module.js';
import { ReportableContentRegistry } from './ports/reportable-content.registry.js';
import {
  Report,
  ReportStatus,
  ReportTargetType,
} from './schemas/report.schema.js';

const EXPECTED_REPORT_KEYS = [
  '_id',
  'createdAt',
  'reason',
  'reporterId',
  'status',
  'targetId',
  'targetType',
  'updatedAt',
];

describe('Moderation Reports API (GEN-09)', () => {
  let testApp: TestApp | undefined;
  let reportModel: Model<Report>;

  let postsFake: FakeReportableContent;
  let commentsFake: FakeReportableContent;
  let reviewsFake: FakeReportableContent;
  let itinerariesFake: FakeReportableContent;

  beforeAll(async () => {
    postsFake = new FakeReportableContent(ReportTargetType.POST);
    commentsFake = new FakeReportableContent(ReportTargetType.COMMENT);
    reviewsFake = new FakeReportableContent(ReportTargetType.REVIEW);
    itinerariesFake = new FakeReportableContent(ReportTargetType.ITINERARY);

    const registry = new ReportableContentRegistry();
    registry.register(postsFake);
    registry.register(commentsFake);
    registry.register(reviewsFake);
    registry.register(itinerariesFake);

    testApp = await createTestApp({
      imports: [ModerationModule],
      override: (builder) =>
        builder.overrideProvider(ReportableContentRegistry).useValue(registry),
    });

    reportModel = testApp.moduleRef.get<Model<Report>>(
      getModelToken(Report.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(testApp!.connection);
    postsFake.clear();
    commentsFake.clear();
    reviewsFake.clear();
    itinerariesFake.clear();
  });

  afterAll(async () => {
    await testApp?.close();
  }, HOOK_TIMEOUT);

  it('registers Swagger documentation for POST /api/reports with no admin resolution routes', () => {
    const document = SwaggerModule.createDocument(
      testApp!.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .addCookieAuth('access_token')
        .build(),
    );

    const reportsPath = document.paths['/api/reports'];
    expect(reportsPath?.post).toBeDefined();
    expect(reportsPath?.post?.tags).toContain('moderation');
    expect(reportsPath?.post?.summary).toMatch(/^GEN-09/);
    expect(reportsPath?.post?.security).toBeDefined();
    expect(reportsPath?.post?.responses?.['201']).toBeDefined();
    expect(reportsPath?.post?.responses?.['400']).toBeDefined();
    expect(reportsPath?.post?.responses?.['401']).toBeDefined();
    expect(reportsPath?.post?.responses?.['404']).toBeDefined();
    expect(reportsPath?.post?.responses?.['409']).toBeDefined();
    expect(reportsPath?.get).toBeUndefined();
    expect(reportsPath?.patch).toBeUndefined();
    expect(reportsPath?.delete).toBeUndefined();
  });

  it('rejects unauthenticated requests with 401 NOT_AUTHENTICATED', async () => {
    const postId = new Types.ObjectId().toHexString();
    postsFake.add(postId);

    const res = await testApp!.http().post('/api/reports').send({
      targetType: ReportTargetType.POST,
      targetId: postId,
      reason: 'Spam',
    });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      code: ErrorCode.NotAuthenticated,
      path: '/api/reports',
    });
    expect(await reportModel.countDocuments()).toBe(0);
  });

  it('allows any logged-in role, derives reporterId from session, and returns exact report shape across all 4 types', async () => {
    const rolesAndTargets: [
      UserRole,
      ReportTargetType,
      FakeReportableContent,
    ][] = [
      [UserRole.USER, ReportTargetType.POST, postsFake],
      [UserRole.AIRLINE_MODERATOR, ReportTargetType.COMMENT, commentsFake],
      [UserRole.HOTEL_MODERATOR, ReportTargetType.REVIEW, reviewsFake],
      [UserRole.ADMIN, ReportTargetType.ITINERARY, itinerariesFake],
    ];

    for (const [role, targetType, fake] of rolesAndTargets) {
      const actor = await loginAs(testApp!.connection, role, {
        providerId: new Types.ObjectId().toHexString(),
      });
      const targetId = new Types.ObjectId().toHexString();
      fake.add(targetId, { isHidden: role === UserRole.ADMIN });

      const res = await testApp!
        .http()
        .post('/api/reports')
        .set('Cookie', actor.cookie)
        .send({
          targetType,
          targetId,
          reason: `  Reported ${targetType}  `,
        });

      expect(res.status).toBe(201);
      expect(Object.keys(res.body as Record<string, unknown>).sort()).toEqual(
        EXPECTED_REPORT_KEYS,
      );
      expect(res.body).toMatchObject({
        reporterId: actor.id,
        targetType,
        targetId,
        reason: `Reported ${targetType}`,
        status: ReportStatus.OPEN,
      });
      expect(typeof res.body._id).toBe('string');
      expect(Types.ObjectId.isValid(res.body._id as string)).toBe(true);
      expect(Number.isNaN(Date.parse(res.body.createdAt as string))).toBe(
        false,
      );
      expect(Number.isNaN(Date.parse(res.body.updatedAt as string))).toBe(
        false,
      );
    }
  });

  it('accepts reason length boundaries 1 and 500 after trimming', async () => {
    const user = await loginAs(testApp!.connection, UserRole.USER);
    const id1 = new Types.ObjectId().toHexString();
    const id500 = new Types.ObjectId().toHexString();
    postsFake.add(id1);
    postsFake.add(id500);

    const minRes = await testApp!
      .http()
      .post('/api/reports')
      .set('Cookie', user.cookie)
      .send({
        targetType: ReportTargetType.POST,
        targetId: id1,
        reason: '  !  ',
      });
    expect(minRes.status).toBe(201);
    expect(minRes.body.reason).toBe('!');

    const maxRes = await testApp!
      .http()
      .post('/api/reports')
      .set('Cookie', user.cookie)
      .send({
        targetType: ReportTargetType.POST,
        targetId: id500,
        reason: ` ${'x'.repeat(500)} `,
      });
    expect(maxRes.status).toBe(201);
    expect(maxRes.body.reason).toHaveLength(500);
  });

  it('returns 400 VALIDATION_FAILED with field details for missing, invalid, malformed, or extra fields', async () => {
    const user = await loginAs(testApp!.connection, UserRole.USER);
    const validId = new Types.ObjectId().toHexString();
    postsFake.add(validId);

    const invalidCases: {
      payload: Record<string, unknown>;
      expectedFields: string[];
    }[] = [
      {
        payload: {},
        expectedFields: ['targetType', 'targetId', 'reason'],
      },
      {
        payload: {
          targetType: 'flight',
          targetId: validId,
          reason: 'Invalid type',
        },
        expectedFields: ['targetType'],
      },
      {
        payload: {
          targetType: ReportTargetType.POST,
          targetId: 'not-an-object-id',
          reason: 'Malformed id',
        },
        expectedFields: ['targetId'],
      },
      {
        payload: {
          targetType: ReportTargetType.POST,
          targetId: validId,
          reason: '',
        },
        expectedFields: ['reason'],
      },
      {
        payload: {
          targetType: ReportTargetType.POST,
          targetId: validId,
          reason: '   \t\n  ',
        },
        expectedFields: ['reason'],
      },
      {
        payload: {
          targetType: ReportTargetType.POST,
          targetId: validId,
          reason: 'r'.repeat(501),
        },
        expectedFields: ['reason'],
      },
      {
        payload: {
          targetType: ReportTargetType.POST,
          targetId: validId,
          reason: 123,
        },
        expectedFields: ['reason'],
      },
      {
        payload: {
          targetType: ReportTargetType.POST,
          targetId: validId,
          reason: 'Spoofing reporterId',
          reporterId: new Types.ObjectId().toHexString(),
        },
        expectedFields: ['reporterId'],
      },
      {
        payload: {
          targetType: ReportTargetType.POST,
          targetId: validId,
          reason: 'Spoofing status',
          status: ReportStatus.DISMISSED,
        },
        expectedFields: ['status'],
      },
    ];

    for (const { payload, expectedFields } of invalidCases) {
      const res = await testApp!
        .http()
        .post('/api/reports')
        .set('Cookie', user.cookie)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        code: ErrorCode.ValidationFailed,
        path: '/api/reports',
      });
      const detailFields = (res.body.details as { field: string }[]).map(
        (d) => d.field,
      );
      for (const field of expectedFields) {
        expect(detailFields).toContain(field);
      }
    }
  });

  it('returns 404 NOT_FOUND when reporting a missing content item', async () => {
    const user = await loginAs(testApp!.connection, UserRole.USER);
    const missingId = new Types.ObjectId().toHexString();

    const res = await testApp!
      .http()
      .post('/api/reports')
      .set('Cookie', user.cookie)
      .send({
        targetType: ReportTargetType.REVIEW,
        targetId: missingId,
        reason: 'Missing review',
      });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: ErrorCode.NotFound,
      path: '/api/reports',
    });
    expect(await reportModel.countDocuments()).toBe(0);
  });

  it('returns 409 ALREADY_REPORTED on duplicate and repeated reports while keeping one document', async () => {
    const user = await loginAs(testApp!.connection, UserRole.USER);
    const otherUser = await loginAs(testApp!.connection, UserRole.USER);
    const commentId = new Types.ObjectId().toHexString();
    commentsFake.add(commentId);
    // Same hex ID registered as a different targetType proves composite key uniqueness.
    postsFake.add(commentId);

    const first = await testApp!
      .http()
      .post('/api/reports')
      .set('Cookie', user.cookie)
      .send({
        targetType: ReportTargetType.COMMENT,
        targetId: commentId,
        reason: 'First report',
      });
    expect(first.status).toBe(201);

    for (const reason of ['Second report', 'Third repeated report']) {
      const duplicate = await testApp!
        .http()
        .post('/api/reports')
        .set('Cookie', user.cookie)
        .send({
          targetType: ReportTargetType.COMMENT,
          targetId: commentId,
          reason,
        });

      expect(duplicate.status).toBe(409);
      expect(duplicate.body).toMatchObject({
        statusCode: 409,
        code: ErrorCode.AlreadyReported,
        path: '/api/reports',
      });
    }

    expect(
      await reportModel.countDocuments({
        reporterId: user.id,
        targetType: ReportTargetType.COMMENT,
        targetId: commentId,
      }),
    ).toBe(1);

    const sameUserDifferentType = await testApp!
      .http()
      .post('/api/reports')
      .set('Cookie', user.cookie)
      .send({
        targetType: ReportTargetType.POST,
        targetId: commentId,
        reason: 'Different target type',
      });
    expect(sameUserDifferentType.status).toBe(201);

    const differentUserSameItem = await testApp!
      .http()
      .post('/api/reports')
      .set('Cookie', otherUser.cookie)
      .send({
        targetType: ReportTargetType.COMMENT,
        targetId: commentId,
        reason: 'Second user report',
      });
    expect(differentUserSameItem.status).toBe(201);
  });

  it('enforces the concurrency invariant on parallel duplicate reports (exactly one 201, rest 409, one document stored)', async () => {
    const user = await loginAs(testApp!.connection, UserRole.USER);
    const itineraryId = new Types.ObjectId().toHexString();
    itinerariesFake.add(itineraryId);

    const concurrency = 8;
    const settled = await Promise.allSettled(
      Array.from({ length: concurrency }, (_, index) =>
        testApp!
          .http()
          .post('/api/reports')
          .set('Cookie', user.cookie)
          .send({
            targetType: ReportTargetType.ITINERARY,
            targetId: itineraryId,
            reason: `Parallel spam report #${index}`,
          }),
      ),
    );

    expect(settled.every((item) => item.status === 'fulfilled')).toBe(true);
    const responses = settled
      .filter((item) => item.status === 'fulfilled')
      .map((item) => item.value);

    const created = responses.filter((res) => res.status === 201);
    const conflicts = responses.filter((res) => res.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(concurrency - 1);
    for (const conflict of conflicts) {
      expect(conflict.body).toMatchObject({
        statusCode: 409,
        code: ErrorCode.AlreadyReported,
        path: '/api/reports',
      });
    }

    expect(
      await reportModel.countDocuments({
        reporterId: user.id,
        targetType: ReportTargetType.ITINERARY,
        targetId: itineraryId,
      }),
    ).toBe(1);
  });

  describe('when a valid targetType has no registered ReportableContent provider (CTR-07)', () => {
    let partialApp: TestApp | undefined;

    beforeAll(async () => {
      const partialRegistry = new ReportableContentRegistry();
      partialRegistry.register(
        new FakeReportableContent(ReportTargetType.POST),
      );

      partialApp = await createTestApp({
        imports: [ModerationModule],
        override: (builder) =>
          builder
            .overrideProvider(ReportableContentRegistry)
            .useValue(partialRegistry),
      });
    }, HOOK_TIMEOUT);

    afterAll(async () => {
      await partialApp?.close();
    }, HOOK_TIMEOUT);

    it('returns 500 INTERNAL_ERROR per CTR-07 wiring bug behavior', async () => {
      const user = await loginAs(partialApp!.connection, UserRole.USER);

      const res = await partialApp!
        .http()
        .post('/api/reports')
        .set('Cookie', user.cookie)
        .send({
          targetType: ReportTargetType.ITINERARY,
          targetId: new Types.ObjectId().toHexString(),
          reason: 'Provider not wired',
        });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        statusCode: 500,
        code: ErrorCode.InternalError,
        path: '/api/reports',
      });
    });
  });
});
