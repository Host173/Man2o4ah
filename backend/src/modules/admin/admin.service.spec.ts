import { Test } from '@nestjs/testing';
import { AdminModule } from './admin.module.js';
import { AdminService } from './admin.service.js';

describe('AdminService (skeleton)', () => {
  it('provides and exports AdminService from AdminModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminModule],
    }).compile();

    expect(moduleRef.get(AdminService)).toBeInstanceOf(AdminService);
  });
});
