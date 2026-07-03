import { GitProvider } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';

describe('RepositoriesController', () => {
  let controller: RepositoriesController;

  const repositoriesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    synchronize: jest.fn(),
  };

  const request = {
    user: { userId: 'user-id', email: 'developer@nexusdev.ai' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RepositoriesController],
      providers: [
        { provide: RepositoriesService, useValue: repositoriesService },
      ],
    }).compile();

    controller = module.get<RepositoriesController>(RepositoriesController);
  });

  it('scopes repository creation to the authenticated user and workspace', async () => {
    const dto = {
      name: 'NexusDevAI',
      fullName: 'Rajnisaini895/NexusDevAI',
      provider: GitProvider.GITHUB,
    };
    repositoriesService.create.mockResolvedValue({
      message: 'Repository created successfully',
    });

    await controller.create(request, 'workspace-id', dto);

    expect(repositoriesService.create).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      dto,
    );
  });

  it('scopes repository lookup to the authenticated user and workspace', async () => {
    repositoriesService.findOne.mockResolvedValue({
      repository: { id: 'repository-id' },
    });

    await controller.findOne(request, 'workspace-id', 'repository-id');

    expect(repositoriesService.findOne).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
  });

  it('scopes repository removal to the authenticated user and workspace', async () => {
    repositoriesService.remove.mockResolvedValue({
      message: 'Repository removed successfully',
    });

    await controller.remove(request, 'workspace-id', 'repository-id');

    expect(repositoriesService.remove).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
  });

  it('scopes repository synchronization to the authenticated user and workspace', async () => {
    repositoriesService.synchronize.mockResolvedValue({
      message: 'Repository synchronized successfully',
    });

    await controller.synchronize(request, 'workspace-id', 'repository-id');

    expect(repositoriesService.synchronize).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
  });
});
