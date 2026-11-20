import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FakeReportableContent } from '../../../test/fakes/reportable-content.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import {
  HOOK_TIMEOUT,
  startMemoryMongo,
  type MemoryMongo,
} from '../../../test/support/mongo-memory.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { validationExceptionFactory } from '../../common/errors/validation-exception.factory.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { EventsModule } from '../../common/events/events.module.js';
import { AuditAction } from '../audit/schemas/audit-log.schema.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import { ListReportsQueryDto } from './dto/list-reports-query.dto.js';
import {
  ReportResolutionAction,
  ResolveReportDto,
} from './dto/resolve-report.dto.js';
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
      imports: [EventEmitterModule.forRoot(), EventsModule, ModerationModule],
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
  const fakeEvents = new FakeEvents();

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
        EventEmitterModule.forRoot(),
        EventsModule,
        ModerationModule,
      ],
    })
      .overrideProvider(ReportableContentRegistry)
      .useValue(registry)
      .overrideProvider(AppEvents)
      .useValue(fakeEvents)
      .compile();

    service = moduleRef.get(ModerationService);
    reportModel = moduleRef.get<Model<Report>>(getModelToken(Report.name));
    connection = moduleRef.get<Connection>(getConnectionToken());
    await reportModel.init();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCollections(connection);
    postsFake.clear();
    commentsFake.clear();
    reviewsFake.clear();
    itinerariesFake.clear();
    fakeEvents.clear();
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
        EventEmitterModule.forRoot(),
        EventsModule,
        ModerationModule,
      ],
    })
      .overrideProvider(ReportableContentRegistry)
      .useValue(partialRegistry)
      .overrideProvider(AppEvents)
      .useValue(fakeEvents)
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

  describe('GEN-10 report listing, resolution, concurrency, and direct moderation', () => {
    it('lists reports with default status=open, supports explicit status filters, and rejects invalid status', async () => {
      const adminId = new Types.ObjectId().toHexString();
      const target1 = new Types.ObjectId().toHexString();
      const target2 = new Types.ObjectId().toHexString();
      const target3 = new Types.ObjectId().toHexString();
      const target4 = new Types.ObjectId().toHexString();
      const target5 = new Types.ObjectId().toHexString();
      for (const id of [target1, target2, target3, target4, target5]) {
        postsFake.add(id);
      }

      const openOld = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: target1,
          reason: 'Open older',
        },
        new Types.ObjectId().toHexString(),
      );
      const openNew = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: target2,
          reason: 'Open newer',
        },
        new Types.ObjectId().toHexString(),
      );
      const toDismiss = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: target3,
          reason: 'Dismissed item',
        },
        new Types.ObjectId().toHexString(),
      );
      const toHide = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: target4,
          reason: 'Hidden item',
        },
        new Types.ObjectId().toHexString(),
      );
      const toDelete = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: target5,
          reason: 'Deleted item',
        },
        new Types.ObjectId().toHexString(),
      );

      await reportModel.updateOne(
        { _id: new Types.ObjectId(openOld._id) },
        { $set: { createdAt: new Date('2026-11-10T08:00:00.000Z') } },
      );
      await reportModel.updateOne(
        { _id: new Types.ObjectId(openNew._id) },
        { $set: { createdAt: new Date('2026-11-11T08:00:00.000Z') } },
      );

      await service.resolveReport(
        toDismiss._id,
        { action: ReportResolutionAction.DISMISS },
        adminId,
      );
      await service.resolveReport(
        toHide._id,
        { action: ReportResolutionAction.HIDE },
        adminId,
      );
      await service.resolveReport(
        toDelete._id,
        { action: ReportResolutionAction.DELETE },
        adminId,
      );

      const defaultOpen = await service.listReports();
      expect(defaultOpen.total).toBe(2);
      expect(defaultOpen.items.map((r) => r._id)).toEqual([
        openNew._id,
        openOld._id,
      ]);

      const page2 = await service.listReports(
        plainToInstance(ListReportsQueryDto, { page: 2, limit: 1 }),
      );
      expect(page2.total).toBe(2);
      expect(page2.totalPages).toBe(2);
      expect(page2.items.map((r) => r._id)).toEqual([openOld._id]);

      const dismissed = await service.listReports(
        plainToInstance(ListReportsQueryDto, {
          status: ReportStatus.DISMISSED,
        }),
      );
      expect(dismissed.total).toBe(1);
      expect(dismissed.items[0]).toMatchObject({
        _id: toDismiss._id,
        status: ReportStatus.DISMISSED,
        resolvedBy: adminId,
      });

      const hidden = await service.listReports(
        plainToInstance(ListReportsQueryDto, {
          status: ReportStatus.CONTENT_HIDDEN,
        }),
      );
      expect(hidden.items.map((r) => r._id)).toEqual([toHide._id]);

      const deleted = await service.listReports(
        plainToInstance(ListReportsQueryDto, {
          status: ReportStatus.CONTENT_DELETED,
        }),
      );
      expect(deleted.items.map((r) => r._id)).toEqual([toDelete._id]);

      await expect(
        service.listReports(
          Object.assign(new ListReportsQueryDto(), {
            status: 'invalid-status' as unknown as ReportStatus,
          }),
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'status' }],
        },
      });
    });

    it('dismisses a report, closes open sibling reports on the same target, works if content is gone, and emits audit event', async () => {
      const adminId = new Types.ObjectId().toHexString();
      const postId = new Types.ObjectId().toHexString();
      postsFake.add(postId);

      const r1 = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'First report',
        },
        new Types.ObjectId().toHexString(),
      );
      const r2 = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Sibling report',
        },
        new Types.ObjectId().toHexString(),
      );

      // Even if content was already deleted, dismiss still succeeds.
      await postsFake.delete(postId);
      const resolved = await service.resolveReport(
        r1._id,
        { action: ReportResolutionAction.DISMISS },
        adminId,
      );

      expect(resolved).toMatchObject({
        _id: r1._id,
        status: ReportStatus.DISMISSED,
        resolvedBy: adminId,
      });
      expect(resolved.resolvedAt).toBeInstanceOf(Date);

      const sibling = await reportModel.findById(r2._id).lean().exec();
      expect(sibling?.status).toBe(ReportStatus.DISMISSED);
      expect(sibling?.resolvedBy?.toHexString()).toBe(adminId);

      const auditEvents = fakeEvents.payloadsOf(Events.AdminAction);
      expect(auditEvents).toEqual([
        {
          actorId: adminId,
          action: AuditAction.REPORT_RESOLVED,
          target: { type: 'report', id: r1._id },
          details: {
            action: ReportResolutionAction.DISMISS,
            status: ReportStatus.DISMISSED,
            targetType: ReportTargetType.POST,
            targetId: postId,
            closedCount: 2,
          },
        },
      ]);
    });

    it('hides and deletes content across all four types via resolveReport, closes sibling reports, and emits both audit events', async () => {
      const adminId = new Types.ObjectId().toHexString();
      const fakesByType: [ReportTargetType, FakeReportableContent][] = [
        [ReportTargetType.POST, postsFake],
        [ReportTargetType.COMMENT, commentsFake],
        [ReportTargetType.REVIEW, reviewsFake],
        [ReportTargetType.ITINERARY, itinerariesFake],
      ];

      for (const [targetType, fake] of fakesByType) {
        fakeEvents.clear();
        const hideId = new Types.ObjectId().toHexString();
        const deleteId = new Types.ObjectId().toHexString();
        fake.add(hideId);
        fake.add(deleteId);

        const rHide1 = await service.createReport(
          { targetType, targetId: hideId, reason: 'Hide 1' },
          new Types.ObjectId().toHexString(),
        );
        const rHide2 = await service.createReport(
          { targetType, targetId: hideId, reason: 'Hide 2' },
          new Types.ObjectId().toHexString(),
        );

        const hiddenRes = await service.resolveReport(
          rHide1._id,
          { action: ReportResolutionAction.HIDE },
          adminId,
        );
        expect(hiddenRes.status).toBe(ReportStatus.CONTENT_HIDDEN);
        expect(fake.isHidden(hideId)).toBe(true);
        expect((await reportModel.findById(rHide2._id).lean())?.status).toBe(
          ReportStatus.CONTENT_HIDDEN,
        );
        expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
          {
            actorId: adminId,
            action: AuditAction.REPORT_RESOLVED,
            target: { type: 'report', id: rHide1._id },
            details: {
              action: ReportResolutionAction.HIDE,
              status: ReportStatus.CONTENT_HIDDEN,
              targetType,
              targetId: hideId,
              closedCount: 2,
            },
          },
          {
            actorId: adminId,
            action: AuditAction.CONTENT_HIDDEN,
            target: { type: targetType, id: hideId },
            details: { reportId: rHide1._id },
          },
        ]);

        fakeEvents.clear();
        const rDelete = await service.createReport(
          { targetType, targetId: deleteId, reason: 'Delete item' },
          new Types.ObjectId().toHexString(),
        );
        const deletedRes = await service.resolveReport(
          rDelete._id,
          { action: ReportResolutionAction.DELETE },
          adminId,
        );
        expect(deletedRes.status).toBe(ReportStatus.CONTENT_DELETED);
        expect(fake.has(deleteId)).toBe(false);
        expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
          {
            actorId: adminId,
            action: AuditAction.REPORT_RESOLVED,
            target: { type: 'report', id: rDelete._id },
            details: {
              action: ReportResolutionAction.DELETE,
              status: ReportStatus.CONTENT_DELETED,
              targetType,
              targetId: deleteId,
              closedCount: 1,
            },
          },
          {
            actorId: adminId,
            action: AuditAction.CONTENT_DELETED,
            target: { type: targetType, id: deleteId },
            details: { reportId: rDelete._id },
          },
        ]);
      }
    });

    it('rejects already-resolved reports with 409, rolls back on missing target or handler failure, and rejects invalid IDs/actions', async () => {
      const adminId = new Types.ObjectId().toHexString();
      const postId = new Types.ObjectId().toHexString();
      postsFake.add(postId);

      const report = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Test report',
        },
        new Types.ObjectId().toHexString(),
      );

      // Simulate unexpected port handler throw -> report rolls back to open and no events emitted.
      vi.spyOn(postsFake, 'hide').mockRejectedValueOnce(
        new Error('storage failure'),
      );
      await expect(
        service.resolveReport(
          report._id,
          { action: ReportResolutionAction.HIDE },
          adminId,
        ),
      ).rejects.toThrow('storage failure');

      const afterFailedHandler = await reportModel
        .findById(report._id)
        .lean()
        .exec();
      expect(afterFailedHandler?.status).toBe(ReportStatus.OPEN);
      expect(afterFailedHandler?.resolvedBy).toBeUndefined();
      expect(afterFailedHandler?.resolvedAt).toBeUndefined();
      expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);

      // Missing target on hide -> 404 NOT_FOUND and report rolls back to open.
      await postsFake.delete(postId);
      await expect(
        service.resolveReport(
          report._id,
          { action: ReportResolutionAction.HIDE },
          adminId,
        ),
      ).rejects.toMatchObject({
        constructor: NotFoundException,
        response: { code: ErrorCode.NotFound },
      });
      expect((await reportModel.findById(report._id).lean())?.status).toBe(
        ReportStatus.OPEN,
      );
      expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);

      // Dismiss succeeds, then second resolution returns 409 INVALID_STATUS_TRANSITION without emitting events.
      await service.resolveReport(
        report._id,
        { action: ReportResolutionAction.DISMISS },
        adminId,
      );
      fakeEvents.clear();

      await expect(
        service.resolveReport(
          report._id,
          { action: ReportResolutionAction.DISMISS },
          adminId,
        ),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        response: { code: ErrorCode.InvalidStatusTransition },
      });
      expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);

      await expect(
        service.resolveReport(
          new Types.ObjectId().toHexString(),
          { action: ReportResolutionAction.DISMISS },
          adminId,
        ),
      ).rejects.toMatchObject({
        constructor: NotFoundException,
        response: { code: ErrorCode.NotFound },
      });

      await expect(
        service.resolveReport(
          'bad-id',
          { action: ReportResolutionAction.DISMISS },
          adminId,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'reportId' }],
        },
      });

      await expect(
        pipe.transform(
          { action: 'ban' },
          { type: 'body', metatype: ResolveReportDto },
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: { code: ErrorCode.ValidationFailed },
      });

      await expect(
        service.resolveReport(
          report._id,
          { action: 'ban' as unknown as ReportResolutionAction },
          adminId,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'action' }],
        },
      });
    });

    it('handles concurrent resolutions on the same report and open sibling reports without duplicate actions', async () => {
      const adminId = new Types.ObjectId().toHexString();
      const postId = new Types.ObjectId().toHexString();
      postsFake.add(postId);

      const r1 = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Concurrent 1',
        },
        new Types.ObjectId().toHexString(),
      );
      const r2 = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Concurrent 2',
        },
        new Types.ObjectId().toHexString(),
      );
      const r3 = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Concurrent 3',
        },
        new Types.ObjectId().toHexString(),
      );

      const hideSpy = vi.spyOn(postsFake, 'hide');
      const deleteSpy = vi.spyOn(postsFake, 'delete');

      const settled = await Promise.allSettled([
        service.resolveReport(
          r1._id,
          { action: ReportResolutionAction.HIDE },
          adminId,
        ),
        service.resolveReport(
          r1._id,
          { action: ReportResolutionAction.HIDE },
          adminId,
        ),
        service.resolveReport(
          r2._id,
          { action: ReportResolutionAction.HIDE },
          adminId,
        ),
        service.resolveReport(
          r3._id,
          { action: ReportResolutionAction.HIDE },
          adminId,
        ),
        service.resolveReport(
          r1._id,
          { action: ReportResolutionAction.HIDE },
          adminId,
        ),
      ]);

      const fulfilled = settled.filter((item) => item.status === 'fulfilled');
      const rejected = settled.filter((item) => item.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      for (const failure of rejected) {
        expect(failure.reason).toBeInstanceOf(HttpException);
        const err = failure.reason as HttpException;
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse()).toMatchObject({
          code: ErrorCode.InvalidStatusTransition,
        });
      }

      expect(hideSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).not.toHaveBeenCalled();

      const stored = await reportModel.find({ targetId: postId }).lean().exec();
      expect(stored).toHaveLength(3);
      for (const doc of stored) {
        expect(doc.status).toBe(ReportStatus.CONTENT_HIDDEN);
      }

      const actions = fakeEvents.payloadsOf(Events.AdminAction);
      expect(actions).toHaveLength(2);
      expect(
        actions.find((e) => e.action === AuditAction.REPORT_RESOLVED)?.details
          ?.closedCount,
      ).toBe(3);
      expect(actions.some((e) => e.action === AuditAction.CONTENT_HIDDEN)).toBe(
        true,
      );
    });

    it('supports direct hideContent and deleteContent across all four types, closes open reports, and rejects invalid inputs', async () => {
      const adminId = new Types.ObjectId().toHexString();
      const postId = new Types.ObjectId().toHexString();
      const reviewId = new Types.ObjectId().toHexString();
      postsFake.add(postId);
      reviewsFake.add(reviewId);

      const postReport = await service.createReport(
        {
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Direct hide target',
        },
        new Types.ObjectId().toHexString(),
      );
      await service.hideContent(ReportTargetType.POST, postId, adminId);
      expect(postsFake.isHidden(postId)).toBe(true);
      expect((await reportModel.findById(postReport._id).lean())?.status).toBe(
        ReportStatus.CONTENT_HIDDEN,
      );
      expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
        {
          actorId: adminId,
          action: AuditAction.CONTENT_HIDDEN,
          target: { type: ReportTargetType.POST, id: postId },
          details: { closedReportCount: 1 },
        },
      ]);

      fakeEvents.clear();
      const reviewReport = await service.createReport(
        {
          targetType: ReportTargetType.REVIEW,
          targetId: reviewId,
          reason: 'Direct delete target',
        },
        new Types.ObjectId().toHexString(),
      );
      await service.deleteContent(ReportTargetType.REVIEW, reviewId, adminId);
      expect(reviewsFake.has(reviewId)).toBe(false);
      expect(
        (await reportModel.findById(reviewReport._id).lean())?.status,
      ).toBe(ReportStatus.CONTENT_DELETED);
      expect(fakeEvents.payloadsOf(Events.AdminAction)).toEqual([
        {
          actorId: adminId,
          action: AuditAction.CONTENT_DELETED,
          target: { type: ReportTargetType.REVIEW, id: reviewId },
          details: { closedReportCount: 1 },
        },
      ]);

      fakeEvents.clear();
      await expect(
        service.hideContent(
          ReportTargetType.ITINERARY,
          new Types.ObjectId().toHexString(),
          adminId,
        ),
      ).rejects.toMatchObject({
        constructor: NotFoundException,
        response: { code: ErrorCode.NotFound },
      });
      await expect(
        service.deleteContent(
          'flight' as unknown as ReportTargetType,
          new Types.ObjectId().toHexString(),
          adminId,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'type' }],
        },
      });
      await expect(
        service.hideContent(ReportTargetType.POST, 'bad-id', adminId),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'id' }],
        },
      });
      expect(fakeEvents.payloadsOf(Events.AdminAction)).toHaveLength(0);
    });
  });
});
