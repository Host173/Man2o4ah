import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModerationController } from './moderation.controller.js';
import { ModerationService } from './moderation.service.js';
import { ReportableContentRegistry } from './ports/reportable-content.registry.js';
import { Report, ReportSchema } from './schemas/report.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
  ],
  controllers: [ModerationController],
  providers: [ModerationService, ReportableContentRegistry],
  exports: [ModerationService, ReportableContentRegistry],
})
export class ModerationModule {}
