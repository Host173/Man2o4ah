import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModerationService } from './moderation.service.js';
import { ReportableContentRegistry } from './ports/reportable-content.registry.js';
import { Report, ReportSchema } from './schemas/report.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
  ],
  providers: [ModerationService, ReportableContentRegistry],
  exports: [ModerationService, ReportableContentRegistry],
})
export class ModerationModule {}
