import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberRole } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { RepositoriesService } from './repositories.service';
import { RepositoryProcessingService } from './repository-processing.service';

interface ProcessingUpdateArgs {
  where: { id: string };
  data: Record<string, unknown>;
  select?: Record<string, unknown>;
}

describe('RepositoryProcessingService', () => {
  let service: RepositoryProcessingService;
  let lastUpdate: ProcessingUpdateArgs | null;

  const prisma = {
    repository: { findFirst: jest.fn() },
    repositoryProcessingRun: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn<(args: ProcessingUpdateArgs) => Promise<unknown>>(),
    },
  };
  const repositoriesService = {
    synchronize: jest.fn(),
    ingestFiles: jest.fn(),
    chunkFiles: jest.fn(),
    embedChunks: jest.fn(),
  };
  const queue = { add: jest.fn() };
  const queuedRun = {
    id: 'run-id',
    repositoryId: 'repository-id',
    status: 'QUEUED',
    stage: 'QUEUED',
    progress: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-07-12T00:00:00.000Z'),
    updatedAt: new Date('2026-07-12T00:00:00.000Z'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    lastUpdate = null;
    prisma.repository.findFirst.mockResolvedValue({
      id: 'repository-id',
      workspace: {
        organization: {
          memberships: [{ role: MemberRole.DEVELOPER }],
        },
      },
    });
    prisma.repositoryProcessingRun.findFirst.mockResolvedValue(null);
    prisma.repositoryProcessingRun.create.mockResolvedValue(queuedRun);
    prisma.repositoryProcessingRun.update.mockImplementation(
      (args: ProcessingUpdateArgs) => {
        lastUpdate = args;
        return Promise.resolve(queuedRun);
      },
    );
    queue.add.mockResolvedValue({ id: 'run-id' });
    repositoriesService.synchronize.mockResolvedValue({});
    repositoriesService.ingestFiles.mockResolvedValue({});
    repositoriesService.chunkFiles.mockResolvedValue({});
    repositoriesService.embedChunks.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryProcessingService,
        { provide: PrismaService, useValue: prisma },
        { provide: RepositoriesService, useValue: repositoriesService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test') },
        },
      ],
    }).compile();
    service = module.get(RepositoryProcessingService);
    Reflect.set(service, 'queue', queue);
  });

  it('queues a processing run for an authorized repository developer', async () => {
    await expect(
      service.enqueue('user-id', 'workspace-id', 'repository-id'),
    ).resolves.toEqual({
      message: 'Repository processing queued',
      run: queuedRun,
    });

    expect(prisma.repositoryProcessingRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          repositoryId: 'repository-id',
          workspaceId: 'workspace-id',
          requestedByUserId: 'user-id',
        },
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'prepare-repository',
      {
        runId: 'run-id',
        userId: 'user-id',
        workspaceId: 'workspace-id',
        repositoryId: 'repository-id',
      },
      { jobId: 'run-id' },
    );
  });

  it('returns the active run instead of creating a duplicate job', async () => {
    prisma.repositoryProcessingRun.findFirst.mockResolvedValue(queuedRun);

    await expect(
      service.enqueue('user-id', 'workspace-id', 'repository-id'),
    ).resolves.toEqual({
      message: 'Repository processing is already running',
      run: queuedRun,
    });
    expect(prisma.repositoryProcessingRun.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('prevents viewers from queuing repository processing', async () => {
    prisma.repository.findFirst.mockResolvedValue({
      id: 'repository-id',
      workspace: {
        organization: { memberships: [{ role: MemberRole.VIEWER }] },
      },
    });

    await expect(
      service.enqueue('user-id', 'workspace-id', 'repository-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('runs every processing stage in dependency order', async () => {
    await service.processRun({
      runId: 'run-id',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      repositoryId: 'repository-id',
    });

    expect(repositoriesService.synchronize).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
    expect(repositoriesService.ingestFiles).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
    expect(repositoriesService.chunkFiles).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
    expect(repositoriesService.embedChunks).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'repository-id',
    );
    expect(lastUpdate).toMatchObject({
      where: { id: 'run-id' },
      data: {
        status: 'COMPLETED',
        stage: 'COMPLETED',
        progress: 100,
      },
    });
  });

  it('persists a failed stage so the run can be retried', async () => {
    repositoriesService.ingestFiles.mockRejectedValue(
      new Error('GitHub unavailable'),
    );

    await expect(
      service.processRun({
        runId: 'run-id',
        userId: 'user-id',
        workspaceId: 'workspace-id',
        repositoryId: 'repository-id',
      }),
    ).rejects.toThrow('GitHub unavailable');
    expect(lastUpdate).toMatchObject({
      where: { id: 'run-id' },
      data: {
        status: 'FAILED',
        stage: 'FAILED',
        errorMessage: 'GitHub unavailable',
      },
    });
    expect(repositoriesService.chunkFiles).not.toHaveBeenCalled();
  });
});
