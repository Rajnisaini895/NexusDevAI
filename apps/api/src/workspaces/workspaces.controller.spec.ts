import { Test, TestingModule } from '@nestjs/testing';

import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesController', () => {
  let controller: WorkspacesController;

  const workspacesService = {
    create: jest.fn(),
    findAllForOrganization: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacesController],
      providers: [{ provide: WorkspacesService, useValue: workspacesService }],
    }).compile();

    controller = module.get<WorkspacesController>(WorkspacesController);
  });

  it('uses authenticated user and organization IDs during creation', async () => {
    const request = {
      user: { userId: 'user-id', email: 'developer@nexusdev.ai' },
    };
    const dto = { name: 'Platform Engineering' };
    workspacesService.create.mockResolvedValue({
      message: 'Workspace created successfully',
    });

    await controller.create(request, 'organization-id', dto);

    expect(workspacesService.create).toHaveBeenCalledWith(
      'user-id',
      'organization-id',
      dto,
    );
  });

  it('scopes workspace listing to user and organization', async () => {
    const request = {
      user: { userId: 'user-id', email: 'developer@nexusdev.ai' },
    };
    workspacesService.findAllForOrganization.mockResolvedValue({
      workspaces: [],
    });

    await controller.findAll(request, 'organization-id');

    expect(workspacesService.findAllForOrganization).toHaveBeenCalledWith(
      'user-id',
      'organization-id',
    );
  });
});
