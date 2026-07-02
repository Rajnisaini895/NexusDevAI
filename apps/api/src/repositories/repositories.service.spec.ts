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
    membership: {
      findFirst: jest.fn(),
    },
    repository: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    providerConnection: {
      findFirst: jest.fn(),
    },
    workspace: {
      findFirst: jest.fn(),
    },
  };

  const githubAppService = {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: GithubAppService, useValue: githubAppService },
      ],
    }).compile();

    service = module.get<RepositoriesService>(RepositoriesService);
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
