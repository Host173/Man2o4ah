import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { HealthController } from './health.controller.js';

async function createController(readyState: number) {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: getConnectionToken(), useValue: { readyState } }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('reports database "up" when readyState is 1', async () => {
    const controller = await createController(1);
    expect(controller.check()).toEqual({ status: 'ok', database: 'up' });
  });

  it('reports database "down" when readyState is 0', async () => {
    const controller = await createController(0);
    expect(controller.check()).toEqual({ status: 'ok', database: 'down' });
  });
});
