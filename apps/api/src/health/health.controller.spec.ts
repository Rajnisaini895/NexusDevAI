import { Test, TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;

  const healthService = {
    getHealth: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns the service health result', async () => {
    const health = {
      status: 'ok',
      service: 'NexusDev API',
      database: 'connected',
      timestamp: '2026-06-27T00:00:00.000Z',
    };
    healthService.getHealth.mockResolvedValue(health);

    await expect(controller.getHealth()).resolves.toEqual(health);
  });
});
