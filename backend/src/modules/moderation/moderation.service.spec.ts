import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { FakeReportableContent } from '../../../test/fakes/reportable-content.fake.js';
import { ModerationModule } from './moderation.module.js';
import { ModerationService } from './moderation.service.js';
import { ReportTargetType } from './ports/reportable-content.port.js';
import { ReportableContentRegistry } from './ports/reportable-content.registry.js';
import { Report } from './schemas/report.schema.js';

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

describe('ModerationService (skeleton)', () => {
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
