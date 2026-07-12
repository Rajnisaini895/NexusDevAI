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
    ingestFiles: jest.fn(),
    chunkFiles: jest.fn(),
    embedChunks: jest.fn(),
    searchChunks: jest.fn(),
    answerQuestion: jest.fn(),
    findReviews: jest.fn(),
    reviewRepository: jest.fn(),
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

  it('scopes file ingestion to the authenticated user and workspace', async () => {
    repositoriesService.ingestFiles.mockResolvedValue({
      message: 'Repository files ingested successfully',
    });

    await controller.ingestFiles(request, 'workspace-id', 'repository-id');

    expect(repositoriesService.ingestFiles).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
  });

  it('scopes chunk building to the authenticated user and workspace', async () => {
    repositoriesService.chunkFiles.mockResolvedValue({
      message: 'Repository chunks built successfully',
    });

    await controller.chunkFiles(request, 'workspace-id', 'repository-id');

    expect(repositoriesService.chunkFiles).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
  });

  it('scopes embedding generation to the authenticated user and workspace', async () => {
    await controller.embedChunks(request, 'workspace-id', 'repository-id');

    expect(repositoriesService.embedChunks).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
  });

  it('scopes semantic search to the authenticated user and workspace', async () => {
    const dto = { query: 'authentication', limit: 8 };

    await controller.searchChunks(
      request,
      'workspace-id',
      'repository-id',
      dto,
    );

    expect(repositoriesService.searchChunks).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
      dto,
    );
  });

  it('scopes repository questions to the authenticated user and workspace', async () => {
    const dto = { query: 'Where is authentication handled?', limit: 8 };

    await controller.answerQuestion(
      request,
      'workspace-id',
      'repository-id',
      dto,
    );

    expect(repositoriesService.answerQuestion).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
      dto,
    );
  });

  it('scopes saved reviews to the authenticated user and workspace', async () => {
    await controller.findReviews(request, 'workspace-id', 'repository-id');

    expect(repositoriesService.findReviews).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
  });

  it('scopes review runs to the authenticated user and workspace', async () => {
    const dto = { limit: 4 };

    await controller.reviewRepository(
      request,
      'workspace-id',
      'repository-id',
      dto,
    );

    expect(repositoriesService.reviewRepository).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
      dto,
    );
  });
});
