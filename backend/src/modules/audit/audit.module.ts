import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditListener } from './audit.listener.js';
import { AuditService } from './audit.service.js';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [AuditService, AuditListener],
  exports: [AuditService],
})
export class AuditModule {}
