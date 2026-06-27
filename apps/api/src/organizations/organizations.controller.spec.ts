import { Test, TestingModule } from '@nestjs/testing';

import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsController', () => {
  let controller: OrganizationsController;

  const organizationsService = {
    create: jest.fn(),
    findAllForUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationsController],
      providers: [
        { provide: OrganizationsService, useValue: organizationsService },
      ],
    }).compile();

    controller = module.get<OrganizationsController>(OrganizationsController);
  });

  it('uses the authenticated user when creating an organization', async () => {
    const request = {
      user: { userId: 'user-id', email: 'developer@nexusdev.ai' },
    };
    const dto = { name: 'Nexus Engineering' };
    organizationsService.create.mockResolvedValue({
      message: 'Organization created successfully',
    });

    await controller.create(request, dto);

    expect(organizationsService.create).toHaveBeenCalledWith('user-id', dto);
  });

  it('lists organizations for the authenticated user', async () => {
    const request = {
      user: { userId: 'user-id', email: 'developer@nexusdev.ai' },
    };
    organizationsService.findAllForUser.mockResolvedValue({
      organizations: [],
    });

    await controller.findAll(request);

    expect(organizationsService.findAllForUser).toHaveBeenCalledWith('user-id');
  });
});
