import { ForbiddenException } from '@nestjs/common';
import {
  GitProvider,
  MemberRole,
  ProviderConnectionStatus,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { GithubAppService } from './github-app.service';
import { ProviderConnectionsService } from './provider-connections.service';

describe('ProviderConnectionsService', () => {
  let service: ProviderConnectionsService;

  const prisma = {
    membership: {
      findFirst: jest.fn(),
    },
    providerConnection: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const githubAppService = {
    createInstallUrl: jest.fn(),
    getInstallation: jest.fn(),
    listInstallationRepositories: jest.fn(),
    verifyState: jest.fn(),
  };

  const connection = {
    id: 'connection-id',
    provider: GitProvider.GITHUB,
    externalAccountId: '1234',
    accountLogin: 'NexusDevAI',
    installationId: '5678',
    status: ProviderConnectionStatus.ACTIVE,
    connectedByUserId: 'user-id',
    createdAt: new Date('2026-06-30T00:00:00.000Z'),
    updatedAt: new Date('2026-06-30T00:00:00.000Z'),
    disconnectedAt: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.membership.findFirst.mockResolvedValue({ role: MemberRole.OWNER });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderConnectionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GithubAppService, useValue: githubAppService },
      ],
    }).compile();

    service = module.get<ProviderConnectionsService>(
      ProviderConnectionsService,
    );
  });

  it('allows an owner to create a GitHub installation URL', async () => {
    githubAppService.createInstallUrl.mockReturnValue({
      installUrl: 'https://github.com/apps/nexusdev-ai/installations/new',
      expiresInSeconds: 600,
    });

    const result = await service.createGithubInstallUrl(
      'user-id',
      'organization-id',
    );

    expect(githubAppService.createInstallUrl).toHaveBeenCalledWith(
      'organization-id',
      'user-id',
    );
    expect(result.expiresInSeconds).toBe(600);
  });

  it('prevents a developer from managing provider connections', async () => {
    prisma.membership.findFirst.mockResolvedValue({
      role: MemberRole.DEVELOPER,
    });

    await expect(
      service.createGithubInstallUrl('user-id', 'organization-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(githubAppService.createInstallUrl).not.toHaveBeenCalled();
  });

  it('verifies and stores a GitHub App installation', async () => {
    githubAppService.getInstallation.mockResolvedValue({
      id: 5678,
      account: { id: 1234, login: 'NexusDevAI' },
      suspended_at: null,
    });
    prisma.providerConnection.findUnique.mockResolvedValue(null);
    prisma.providerConnection.upsert.mockResolvedValue(connection);

    const result = await service.completeGithubConnection(
      'user-id',
      'organization-id',
      { installationId: '5678', state: 'signed-state' },
    );

    expect(githubAppService.verifyState).toHaveBeenCalledWith(
      'signed-state',
      'organization-id',
      'user-id',
    );
    expect(githubAppService.getInstallation).toHaveBeenCalledWith('5678');
    const [upsertInput] = prisma.providerConnection.upsert.mock.calls[0] as [
      {
        create: {
          organizationId: string;
          connectedByUserId: string;
          provider: GitProvider;
          externalAccountId: string;
          installationId: string;
        };
      },
    ];
    expect(upsertInput.create.organizationId).toBe('organization-id');
    expect(upsertInput.create.connectedByUserId).toBe('user-id');
    expect(upsertInput.create.provider).toBe(GitProvider.GITHUB);
    expect(upsertInput.create.externalAccountId).toBe('1234');
    expect(upsertInput.create.installationId).toBe('5678');
    expect(result.connection).toEqual(connection);
  });

  it('discovers repositories using an active installation', async () => {
    prisma.providerConnection.findFirst.mockResolvedValue({
      installationId: '5678',
    });
    githubAppService.listInstallationRepositories.mockResolvedValue([
      {
        externalId: '1',
        name: 'NexusDevAI',
        fullName: 'Rajnisaini895/NexusDevAI',
        defaultBranch: 'main',
        private: false,
        url: 'https://github.com/Rajnisaini895/NexusDevAI',
      },
    ]);

    const result = await service.discoverRepositories(
      'user-id',
      'organization-id',
      'connection-id',
    );

    expect(githubAppService.listInstallationRepositories).toHaveBeenCalledWith(
      '5678',
    );
    expect(result.repositories).toHaveLength(1);
  });

  it('disconnects a provider connection without deleting its audit record', async () => {
    prisma.providerConnection.findFirst.mockResolvedValue({
      id: 'connection-id',
    });
    prisma.providerConnection.update.mockResolvedValue(connection);

    await expect(
      service.disconnect('user-id', 'organization-id', 'connection-id'),
    ).resolves.toEqual({
      message: 'Provider connection disconnected successfully',
    });

    const [updateInput] = prisma.providerConnection.update.mock.calls[0] as [
      {
        where: { id: string };
        data: {
          status: ProviderConnectionStatus;
          disconnectedAt: Date;
        };
      },
    ];
    expect(updateInput.where).toEqual({ id: 'connection-id' });
    expect(updateInput.data.status).toBe(ProviderConnectionStatus.DISCONNECTED);
    expect(updateInput.data.disconnectedAt).toBeInstanceOf(Date);
  });
});
