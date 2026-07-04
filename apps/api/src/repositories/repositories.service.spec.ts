import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  GitProvider,
  MemberRole,
  Prisma,
  ProviderConnectionStatus,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { GithubAppService } from '../provider-connections/github-app.service';
import { EmbeddingsService } from './embeddings.service';
import { OllamaGenerationService } from './ollama-generation.service';
import { RepositoriesService } from './repositories.service';

describe('RepositoriesService', () => {
  let service: RepositoriesService;

  const prisma = {
    $transaction: jest.fn(),
    membership: {
      findFirst: jest.fn(),
    },
    repository: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    repositoryBranch: {
      upsert: jest.fn(),
    },
    repositoryCommit: {
      upsert: jest.fn(),
    },
    repositoryFile: {
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    repositoryChunk: {
      count: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    providerConnection: {
      findFirst: jest.fn(),
    },
    workspace: {
      findFirst: jest.fn(),
    },
  };

  const githubAppService = {
    getRepositoryMetadata: jest.fn(),
    getRepositoryFiles: jest.fn(),
    listInstallationRepositories: jest.fn(),
  };

  const embeddingsService = {
    model: 'embeddinggemma',
    create: jest.fn(),
  };

  const ollamaGenerationService = {
    model: 'qwen2.5-coder:3b',
    answer: jest.fn(),
  };

  const repository = {
    id: 'repository-id',
    name: 'NexusDevAI',
    fullName: 'Rajnisaini895/NexusDevAI',
    provider: GitProvider.GITHUB,
    externalId: '123456',
    defaultBranch: 'main',
    url: 'https://github.com/Rajnisaini895/NexusDevAI',
    isPrivate: false,
    workspaceId: 'workspace-id',
    providerConnectionId: null,
    createdAt: new Date('2026-06-29T00:00:00.000Z'),
    updatedAt: new Date('2026-06-29T00:00:00.000Z'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.workspace.findFirst.mockResolvedValue({
      organizationId: 'organization-id',
    });
    prisma.membership.findFirst.mockResolvedValue({
      role: MemberRole.DEVELOPER,
    });
    prisma.$transaction.mockResolvedValue([]);
    prisma.repositoryBranch.upsert.mockResolvedValue({});
    prisma.repositoryCommit.upsert.mockResolvedValue({});
    prisma.repositoryFile.deleteMany.mockResolvedValue({ count: 0 });
    prisma.repositoryFile.upsert.mockResolvedValue({});
    prisma.repositoryChunk.deleteMany.mockResolvedValue({ count: 0 });
    prisma.repositoryChunk.createMany.mockResolvedValue({ count: 0 });
    prisma.repositoryChunk.count.mockResolvedValue(0);
    prisma.repositoryChunk.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: GithubAppService, useValue: githubAppService },
        { provide: EmbeddingsService, useValue: embeddingsService },
        {
          provide: OllamaGenerationService,
          useValue: ollamaGenerationService,
        },
      ],
    }).compile();

    service = module.get<RepositoriesService>(RepositoriesService);
  });

  it('synchronizes GitHub branches and commits for a workspace developer', async () => {
    prisma.repository.findFirst.mockResolvedValue({
      id: 'repository-id',
      fullName: 'Rajnisaini895/NexusDevAI',
      defaultBranch: 'main',
      providerConnection: { installationId: '98765' },
    });
    githubAppService.getRepositoryMetadata.mockResolvedValue({
      branches: [{ name: 'main', sha: 'branch-sha', isDefault: true }],
      commits: [
        {
          sha: 'commit-sha',
          message: 'feat: synchronize metadata',
          authorName: 'Rajni',
          authorEmail: 'rajni@example.com',
          committedAt: new Date('2026-07-03T00:00:00.000Z'),
          url: 'https://github.com/Rajnisaini895/NexusDevAI/commit/commit-sha',
        },
      ],
    });

    await expect(
      service.synchronize('user-id', 'workspace-id', 'repository-id'),
    ).resolves.toEqual({
      message: 'Repository synchronized successfully',
      synchronized: { branches: 1, commits: 1 },
    });

    expect(githubAppService.getRepositoryMetadata).toHaveBeenCalledWith(
      '98765',
      'Rajnisaini895/NexusDevAI',
      'main',
    );
    expect(prisma.repositoryBranch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId_name: {
            repositoryId: 'repository-id',
            name: 'main',
          },
        },
      }),
    );
    expect(prisma.repositoryCommit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId_sha: {
            repositoryId: 'repository-id',
            sha: 'commit-sha',
          },
        },
      }),
    );
  });

  it('prevents a viewer from synchronizing repositories', async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: MemberRole.VIEWER });

    await expect(
      service.synchronize('user-id', 'workspace-id', 'repository-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(githubAppService.getRepositoryMetadata).not.toHaveBeenCalled();
  });

  it('rejects a repository without an active GitHub connection', async () => {
    prisma.repository.findFirst.mockResolvedValue(null);

    await expect(
      service.synchronize('user-id', 'workspace-id', 'repository-id'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(githubAppService.getRepositoryMetadata).not.toHaveBeenCalled();
  });

  it('ingests supported GitHub files and removes stale records', async () => {
    prisma.repository.findFirst.mockResolvedValue({
      id: 'repository-id',
      fullName: 'Rajnisaini895/NexusDevAI',
      defaultBranch: 'main',
      providerConnection: { installationId: '98765' },
    });
    githubAppService.getRepositoryFiles.mockResolvedValue({
      files: [
        {
          path: 'src/main.ts',
          sha: 'file-sha',
          size: 42,
          language: 'TypeScript',
          content: 'export const value = 1;',
        },
      ],
      skipped: 2,
      limited: false,
    });

    await expect(
      service.ingestFiles('user-id', 'workspace-id', 'repository-id'),
    ).resolves.toEqual({
      message: 'Repository files ingested successfully',
      ingested: { files: 1, skipped: 2, limited: false },
    });

    expect(prisma.repositoryFile.deleteMany).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repository-id',
        path: { notIn: ['src/main.ts'] },
      },
    });
    expect(prisma.repositoryFile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId_path: {
            repositoryId: 'repository-id',
            path: 'src/main.ts',
          },
        },
      }),
    );
  });

  it('prevents a viewer from ingesting repository files', async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: MemberRole.VIEWER });

    await expect(
      service.ingestFiles('user-id', 'workspace-id', 'repository-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(githubAppService.getRepositoryFiles).not.toHaveBeenCalled();
  });

  it('builds overlapping line-aware chunks for changed files', async () => {
    prisma.repository.findFirst.mockResolvedValue({ id: 'repository-id' });
    prisma.repositoryFile.findMany.mockResolvedValue([
      {
        id: 'file-id',
        repositoryId: 'repository-id',
        sha: 'new-sha',
        language: 'TypeScript',
        content: Array.from(
          { length: 100 },
          (_, index) => `line ${index + 1}`,
        ).join('\n'),
        chunks: [{ sourceSha: 'old-sha' }],
      },
    ]);

    await expect(
      service.chunkFiles('user-id', 'workspace-id', 'repository-id'),
    ).resolves.toEqual({
      message: 'Repository chunks built successfully',
      chunked: { filesProcessed: 1, filesUnchanged: 0, chunksCreated: 2 },
    });

    expect(prisma.repositoryChunk.deleteMany).toHaveBeenCalledWith({
      where: { fileId: 'file-id' },
    });
    expect(prisma.repositoryChunk.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ chunkIndex: 0, startLine: 1, endLine: 80 }),
        expect.objectContaining({ chunkIndex: 1, startLine: 66, endLine: 100 }),
      ],
    });
  });

  it('skips chunk rebuilding when the source SHA is unchanged', async () => {
    prisma.repository.findFirst.mockResolvedValue({ id: 'repository-id' });
    prisma.repositoryFile.findMany.mockResolvedValue([
      {
        id: 'file-id',
        repositoryId: 'repository-id',
        sha: 'same-sha',
        language: 'TypeScript',
        content: 'const ready = true;',
        chunks: [{ sourceSha: 'same-sha' }],
      },
    ]);

    await expect(
      service.chunkFiles('user-id', 'workspace-id', 'repository-id'),
    ).resolves.toEqual({
      message: 'Repository chunks built successfully',
      chunked: { filesProcessed: 0, filesUnchanged: 1, chunksCreated: 0 },
    });

    expect(prisma.repositoryChunk.createMany).not.toHaveBeenCalled();
  });

  it('creates embeddings only for repository chunks that need them', async () => {
    prisma.repository.findFirst.mockResolvedValue({ id: 'repository-id' });
    prisma.repositoryChunk.findMany.mockResolvedValue([
      { id: 'chunk-1', content: 'authentication middleware' },
      { id: 'chunk-2', content: 'workspace membership' },
    ]);
    embeddingsService.create.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);
    prisma.repositoryChunk.count.mockResolvedValue(5);

    await expect(
      service.embedChunks('user-id', 'workspace-id', 'repository-id'),
    ).resolves.toEqual({
      message: 'Repository chunks embedded successfully',
      embedded: { created: 2, unchanged: 3 },
    });

    expect(embeddingsService.create).toHaveBeenCalledWith([
      'authentication middleware',
      'workspace membership',
    ]);
    expect(prisma.repositoryChunk.update).toHaveBeenCalledTimes(2);
  });

  it('ranks embedded chunks by cosine similarity', async () => {
    prisma.repository.findFirst.mockResolvedValue({ id: 'repository-id' });
    embeddingsService.create.mockResolvedValue([[1, 0]]);
    prisma.repositoryChunk.findMany.mockResolvedValue([
      {
        id: 'less-relevant',
        chunkIndex: 0,
        startLine: 1,
        endLine: 20,
        language: 'TypeScript',
        content: 'workspace settings',
        embedding: [0, 1],
        file: { path: 'settings.ts' },
      },
      {
        id: 'most-relevant',
        chunkIndex: 1,
        startLine: 21,
        endLine: 40,
        language: 'TypeScript',
        content: 'login and sessions',
        embedding: [1, 0],
        file: { path: 'auth.ts' },
      },
    ]);

    const result = await service.searchChunks(
      'user-id',
      'workspace-id',
      'repository-id',
      { query: 'authentication', limit: 1 },
    );

    expect(result.results).toEqual([
      expect.objectContaining({
        id: 'most-relevant',
        path: 'auth.ts',
        score: 1,
      }),
    ]);
  });

  it('answers a repository question using the highest-ranked chunks', async () => {
    prisma.repository.findFirst.mockResolvedValue({ id: 'repository-id' });
    embeddingsService.create.mockResolvedValue([[1, 0]]);
    prisma.repositoryChunk.findMany.mockResolvedValue([
      {
        id: 'auth-chunk',
        chunkIndex: 0,
        startLine: 10,
        endLine: 30,
        language: 'TypeScript',
        content: 'export class AuthService {}',
        embedding: [1, 0],
        file: { path: 'src/auth.service.ts' },
      },
    ]);
    ollamaGenerationService.answer.mockResolvedValue({
      answer: 'Authentication is handled by AuthService.',
      model: 'qwen2.5-coder:3b',
    });

    await expect(
      service.answerQuestion('user-id', 'workspace-id', 'repository-id', {
        query: 'Where is authentication handled?',
        limit: 8,
      }),
    ).resolves.toEqual({
      question: 'Where is authentication handled?',
      answer: 'Authentication is handled by AuthService.',
      model: 'qwen2.5-coder:3b',
      sources: [
        expect.objectContaining({
          id: 'auth-chunk',
          path: 'src/auth.service.ts',
          startLine: 10,
          endLine: 30,
        }),
      ],
    });
  });

  it('allows a developer to add a repository to an authorized workspace', async () => {
    prisma.repository.create.mockResolvedValue(repository);

    const result = await service.create('user-id', 'workspace-id', {
      name: ' NexusDevAI ',
      fullName: ' Rajnisaini895/NexusDevAI ',
      provider: GitProvider.GITHUB,
      externalId: ' 123456 ',
      defaultBranch: ' main ',
    });

    expect(prisma.repository.create).toHaveBeenCalledWith({
      data: {
        name: 'NexusDevAI',
        fullName: 'Rajnisaini895/NexusDevAI',
        provider: GitProvider.GITHUB,
        externalId: '123456',
        defaultBranch: 'main',
        workspaceId: 'workspace-id',
      },
      select: {
        id: true,
        name: true,
        fullName: true,
        provider: true,
        externalId: true,
        defaultBranch: true,
        url: true,
        isPrivate: true,
        workspaceId: true,
        providerConnectionId: true,
        _count: {
          select: { branches: true, commits: true, files: true, chunks: true },
        },
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result.repository).toEqual(repository);
  });

  it('prevents a viewer from adding repositories', async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: MemberRole.VIEWER });

    await expect(
      service.create('user-id', 'workspace-id', {
        name: 'NexusDevAI',
        fullName: 'Rajnisaini895/NexusDevAI',
        provider: GitProvider.GITHUB,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.repository.create).not.toHaveBeenCalled();
  });

  it('lists repositories for an authorized workspace member', async () => {
    prisma.repository.findMany.mockResolvedValue([repository]);

    await expect(service.findAll('user-id', 'workspace-id')).resolves.toEqual({
      repositories: [repository],
    });

    expect(prisma.repository.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-id' },
      select: {
        id: true,
        name: true,
        fullName: true,
        provider: true,
        externalId: true,
        defaultBranch: true,
        url: true,
        isPrivate: true,
        workspaceId: true,
        providerConnectionId: true,
        _count: {
          select: { branches: true, commits: true, files: true, chunks: true },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('does not return a repository from another workspace', async () => {
    prisma.repository.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('user-id', 'workspace-id', 'repository-id'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.repository.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'repository-id',
          workspaceId: 'workspace-id',
        },
      }),
    );
  });

  it('imports a repository available through an organization GitHub connection', async () => {
    prisma.providerConnection.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      installationId: '98765',
    });
    githubAppService.listInstallationRepositories.mockResolvedValue([
      {
        externalId: '123456',
        name: 'NexusDevAI',
        fullName: 'Rajnisaini895/NexusDevAI',
        defaultBranch: 'main',
        private: false,
        url: 'https://github.com/Rajnisaini895/NexusDevAI',
      },
    ]);
    prisma.repository.create.mockResolvedValue({
      ...repository,
      providerConnectionId: '11111111-1111-4111-8111-111111111111',
    });

    const result = await service.importFromGithub('user-id', 'workspace-id', {
      connectionId: '11111111-1111-4111-8111-111111111111',
      externalRepositoryId: '123456',
    });

    expect(prisma.providerConnection.findFirst).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        organizationId: 'organization-id',
        provider: GitProvider.GITHUB,
        status: ProviderConnectionStatus.ACTIVE,
        installationId: { not: null },
      },
      select: { id: true, installationId: true },
    });
    expect(prisma.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'NexusDevAI',
          fullName: 'Rajnisaini895/NexusDevAI',
          provider: GitProvider.GITHUB,
          externalId: '123456',
          defaultBranch: 'main',
          url: 'https://github.com/Rajnisaini895/NexusDevAI',
          isPrivate: false,
          workspaceId: 'workspace-id',
          providerConnectionId: '11111111-1111-4111-8111-111111111111',
        },
      }),
    );
    expect(result.message).toBe('Repository imported successfully');
  });

  it('prevents a viewer from importing a repository', async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: MemberRole.VIEWER });

    await expect(
      service.importFromGithub('user-id', 'workspace-id', {
        connectionId: '11111111-1111-4111-8111-111111111111',
        externalRepositoryId: '123456',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.providerConnection.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an inactive or cross-organization GitHub connection', async () => {
    prisma.providerConnection.findFirst.mockResolvedValue(null);

    await expect(
      service.importFromGithub('user-id', 'workspace-id', {
        connectionId: '11111111-1111-4111-8111-111111111111',
        externalRepositoryId: '123456',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(
      githubAppService.listInstallationRepositories,
    ).not.toHaveBeenCalled();
  });

  it('rejects a repository unavailable to the GitHub installation', async () => {
    prisma.providerConnection.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      installationId: '98765',
    });
    githubAppService.listInstallationRepositories.mockResolvedValue([]);

    await expect(
      service.importFromGithub('user-id', 'workspace-id', {
        connectionId: '11111111-1111-4111-8111-111111111111',
        externalRepositoryId: '123456',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.repository.create).not.toHaveBeenCalled();
  });

  it('returns a conflict when an imported repository already exists', async () => {
    prisma.providerConnection.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      installationId: '98765',
    });
    githubAppService.listInstallationRepositories.mockResolvedValue([
      {
        externalId: '123456',
        name: 'NexusDevAI',
        fullName: 'Rajnisaini895/NexusDevAI',
        defaultBranch: 'main',
        private: false,
        url: 'https://github.com/Rajnisaini895/NexusDevAI',
      },
    ]);
    prisma.repository.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );

    await expect(
      service.importFromGithub('user-id', 'workspace-id', {
        connectionId: '11111111-1111-4111-8111-111111111111',
        externalRepositoryId: '123456',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows an admin to remove a workspace repository', async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: MemberRole.ADMIN });
    prisma.repository.findFirst.mockResolvedValue({ id: 'repository-id' });
    prisma.repository.delete.mockResolvedValue({ id: 'repository-id' });

    await expect(
      service.remove('user-id', 'workspace-id', 'repository-id'),
    ).resolves.toEqual({ message: 'Repository removed successfully' });

    expect(prisma.repository.delete).toHaveBeenCalledWith({
      where: { id: 'repository-id' },
    });
  });

  it('rejects users without organization membership', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.findAll('user-id', 'workspace-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.repository.findMany).not.toHaveBeenCalled();
  });
});
