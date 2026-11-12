import { NotImplementedException } from '@nestjs/common';
import { AuditLogQueryDto } from './audit.types.js';
import { AuditService } from './audit.service.js';

describe('AuditService (stub)', () => {
  it('list is not implemented yet (GEN-07)', () => {
    expect(() => new AuditService().list(new AuditLogQueryDto())).toThrow(
      NotImplementedException,
    );
  });
});
