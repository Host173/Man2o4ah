import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeReportableContent } from '../../../test/fakes/reportable-content.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import {
  HOOK_TIMEOUT,
  startMemoryMongo,
  type MemoryMongo,
} from '../../../test/support/mongo-memory.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { validationExceptionFactory } from '../../common/errors/validation-exception.factory.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import { ModerationModule } from './moderation.module.js';
import { ModerationService } from './moderation.service.js';
import { ReportTargetType } from './ports/reportable-content.port.js';
import { ReportableContentRegistry } from './ports/reportable-content.registry.js';
import { Report, ReportStatus } from './schemas/report.schema.js';

@Injectable()
class PostReportableContentStub
  extends FakeReportableContent
  implements OnModuleInit
{
  constructor(private readonly registry: ReportableContentRegistry) {
    super(ReportTargetType.POST, ['post-1']);
  }

  onModuleInit(): void {
    this.registry.register(this);
  }
}

describe('ModerationService (wiring)', () => {
  it('provides and exports ModerationService and ReportableContentRegistry from ModerationModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ModerationModule],
      providers: [PostReportableContentStub],
    })
      .overrideProvider(getModelToken(Report.name))
      .useValue({})
      .compile();

    await moduleRef.init();

    expect(moduleRef.get(ModerationService)).toBeInstanceOf(ModerationService);
    const registry = moduleRef.get(ReportableContentRegistry);
    expect(registry).toBeInstanceOf(ReportableContentRegistry);
    expect(registry.get(ReportTargetType.POST)).toBe(
      moduleRef.get(PostReportableContentStub),
    );
  });
});

describe('ModerationService integration (GEN-09)', () => {
  let mongo: MemoryMongo;
  let moduleRef: TestingModule;
  let service: ModerationService;
  let reportModel: Model<Report>;
  let connection: Connection;

  let postsFake: FakeReportableContent;
  let commentsFake: FakeReportableContent;
  let reviewsFake: FakeReportableContent;
  let itinerariesFake: FakeReportableContent;

  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    postsFake = new FakeReportableContent(ReportTargetType.POST);
    commentsFake = new FakeReportableContent(ReportTargetType.COMMENT);
    reviewsFake = new FakeReportableContent(ReportTargetType.REVIEW);
    itinerariesFake = new FakeReportableContent(ReportTargetType.ITINERARY);

    const registry = new ReportableContentRegistry();
    registry.register(postsFake);
    registry.register(commentsFake);
    registry.register(reviewsFake);
    registry.register(itinerariesFake);

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.uri, { dbName: 'moderation-service' }),
        ModerationModule,
      ],
    })
      .overrideProvider(ReportableContentRegistry)
      .useValue(registry)
      .compile();

    service = moduleRef.get(ModerationService);
    reportModel = moduleRef.get<Model<Report>>(getModelToken(Report.name));
    connection = moduleRef.get<Connection>(getConnectionToken());
    await reportModel.init();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(connection);
    postsFake.clear();
    commentsFake.clear();
    reviewsFake.clear();
    itinerariesFake.clear();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await mongo?.stop();
  }, HOOK_TIMEOUT);

  it('creates an open report for each of the four reportable content types', async () => {
    const fakesByType: [ReportTargetType, FakeReportableContent][] = [
      [ReportTargetType.POST, postsFake],
      [ReportTargetType.COMMENT, commentsFake],
      [ReportTargetType.REVIEW, reviewsFake],
      [ReportTargetType.ITINERARY, itinerariesFake],
    ];

    for (const [targetType, fake] of fakesByType) {
      const reporterId = new Types.ObjectId().toHexString();
      const targetId = new Types.ObjectId().toHexString();
      fake.add(targetId);

      const created = await service.createReport(
        {
          targetType,
          targetId,
          reason: `  Violation in ${targetType}  `,
        },
        reporterId,
      );

      expect(created).toMatchObject({
        reporterId,
        targetType,
        targetId,
        reason: `Violation in ${targetType}`,
        status: ReportStatus.OPEN,
      });
      expect(created.resolvedBy).toBeUndefined();
      expect(created.resolvedAt).toBeUndefined();
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);

      const stored = await reportModel.findById(created._id).lean().exec();
      expect(stored?.status).toBe(ReportStatus.OPEN);
      expect(stored?.reason).toBe(`Violation in ${targetType}`);
    }
  });

  it('throws 404 NOT_FOUND when the reported item does not exist', async () => {
    const reporterId = new Types.ObjectId().toHexString();
    const missingId = new Types.ObjectId().toHexString();

    await expect(
      service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: missingId,
          reason: 'Abusive post',
        },
        reporterId,
      ),
    ).rejects.toMatchObject({
      constructor: NotFoundException,
      response: { code: ErrorCode.NotFound },
    });

    expect(await reportModel.countDocuments()).toBe(0);
  });

  it('follows CTR-07 behavior (throws registry error) when a valid targetType has no registered provider', async () => {
    const partialRegistry = new ReportableContentRegistry();
    partialRegistry.register(new FakeReportableContent(ReportTargetType.POST));

    const partialModule = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.uri, { dbName: 'moderation-partial' }),
        ModerationModule,
      ],
    })
      .overrideProvider(ReportableContentRegistry)
      .useValue(partialRegistry)
      .compile();

    try {
      const partialModel = partialModule.get<Model<Report>>(
        getModelToken(Report.name),
      );
      await partialModel.init();
      const partialService = partialModule.get(ModerationService);

      await expect(
        partialService.createReport(
          {
            targetType: ReportTargetType.ITINERARY,
            targetId: new Types.ObjectId().toHexString(),
            reason: 'Misleading itinerary',
          },
          new Types.ObjectId().toHexString(),
        ),
      ).rejects.toThrow(/No ReportableContent is registered for "itinerary"/);
    } finally {
      await partialModule.close();
    }
  });

  it('enforces reason boundaries (0, 1, 500, 501 characters and whitespace-only) in both DTO and service', async () => {
    const targetId1 = new Types.ObjectId().toHexString();
    const targetId500 = new Types.ObjectId().toHexString();
    postsFake.add(targetId1);
    postsFake.add(targetId500);

    const reporterId = new Types.ObjectId().toHexString();

    // Exact lower (1 char) and upper (500 chars) boundaries pass after trimming.
    const minDto = (await pipe.transform(
      { targetType: ReportTargetType.POST, targetId: targetId1, reason: ' x ' },
      { type: 'body', metatype: CreateReportDto },
    )) as CreateReportDto;
    const minReport = await service.createReport(minDto, reporterId);
    expect(minReport.reason).toBe('x');

    const maxDto = (await pipe.transform(
      {
        targetType: ReportTargetType.POST,
        targetId: targetId500,
        reason: ` ${'b'.repeat(500)} `,
      },
      { type: 'body', metatype: CreateReportDto },
    )) as CreateReportDto;
    const maxReport = await service.createReport(maxDto, reporterId);
    expect(maxReport.reason).toHaveLength(500);

    // Invalid boundaries: 0 chars, whitespace-only, 501 chars, and non-string.
    const invalidReasons: unknown[] = ['', '   ', '\t\n ', 'c'.repeat(501), 42];
    for (const reason of invalidReasons) {
      await expect(
        pipe.transform(
          { targetType: ReportTargetType.POST, targetId: targetId1, reason },
          { type: 'body', metatype: CreateReportDto },
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: { code: ErrorCode.ValidationFailed },
      });

      await expect(
        service.createReport(
          {
            targetType: ReportTargetType.POST,
            targetId: targetId1,
            reason: reason as string,
          },
          reporterId,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'reason' }],
        },
      });
    }
  });

  it('allows different users to report the same content item once each and rejects duplicate by same user', async () => {
    const reviewId = new Types.ObjectId().toHexString();
    reviewsFake.add(reviewId);
    const userA = new Types.ObjectId().toHexString();
    const userB = new Types.ObjectId().toHexString();

    const first = await service.createReport(
      {
        targetType: ReportTargetType.REVIEW,
        targetId: reviewId,
        reason: 'Fake review',
      },
      userA,
    );
    const second = await service.createReport(
      {
        targetType: ReportTargetType.REVIEW,
        targetId: reviewId,
        reason: 'Offensive language',
      },
      userB,
    );

    expect(first.reporterId).toBe(userA);
    expect(second.reporterId).toBe(userB);
    expect(await reportModel.countDocuments({ targetId: reviewId })).toBe(2);

    await expect(
      service.createReport(
        {
          targetType: ReportTargetType.REVIEW,
          targetId: reviewId,
          reason: 'Reporting again',
        },
        userA,
      ),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: ErrorCode.AlreadyReported },
    });
  });

  it('rejects malformed reporterId, targetId, or unknown targetType in service calls', async () => {
    await expect(
      service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: new Types.ObjectId().toHexString(),
          reason: 'Valid reason',
        },
        'not-an-object-id',
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'reporterId' }],
      },
    });

    await expect(
      service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: 'bad-target-id',
          reason: 'Valid reason',
        },
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'targetId' }],
      },
    });

    await expect(
      service.createReport(
        {
          targetType: 'flight' as unknown as ReportTargetType,
          targetId: new Types.ObjectId().toHexString(),
          reason: 'Valid reason',
        },
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'targetType' }],
      },
    });
  });
});
