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
      upsert: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: GithubAppService, useValue: githubAppService },
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
          select: { branches: true, commits: true, files: true },
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
          select: { branches: true, commits: true, files: true },
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
