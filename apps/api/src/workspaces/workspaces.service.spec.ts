import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService', () => {
  let service: WorkspacesService;

  const prisma = {
    membership: {
      findFirst: jest.fn(),
    },
    workspace: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WorkspacesService>(WorkspacesService);
  });

  it('allows an organization owner to create a workspace', async () => {
    const createdAt = new Date('2026-06-27T00:00:00.000Z');
    prisma.membership.findFirst.mockResolvedValue({ role: 'OWNER' });
    prisma.workspace.create.mockResolvedValue({
      id: 'workspace-id',
      name: 'Platform Engineering',
      slug: 'platform-engineering',
      organizationId: 'organization-id',
      createdAt,
    });

    const result = await service.create('user-id', 'organization-id', {
      name: '  Platform Engineering  ',
    });

    expect(prisma.membership.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        organizationId: 'organization-id',
        organization: { deletedAt: null },
      },
      select: { role: true },
    });
    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: 'Platform Engineering',
        slug: 'platform-engineering',
        organizationId: 'organization-id',
      },
      select: {
        id: true,
        name: true,
        slug: true,
        organizationId: true,
        createdAt: true,
      },
    });
    expect(result.workspace.id).toBe('workspace-id');
  });

  it('prevents developers from creating workspaces', async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: 'DEVELOPER' });

    await expect(
      service.create('user-id', 'organization-id', {
        name: 'Platform Engineering',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.workspace.create).not.toHaveBeenCalled();
  });

  it('allows an organization member to list active workspaces', async () => {
    const workspaces = [
      {
        id: 'workspace-id',
        name: 'Platform Engineering',
        slug: 'platform-engineering',
        organizationId: 'organization-id',
        createdAt: new Date('2026-06-27T00:00:00.000Z'),
      },
    ];
    prisma.membership.findFirst.mockResolvedValue({ role: 'VIEWER' });
    prisma.workspace.findMany.mockResolvedValue(workspaces);

    await expect(
      service.findAllForOrganization('user-id', 'organization-id'),
    ).resolves.toEqual({ workspaces });

    expect(prisma.workspace.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'organization-id',
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        organizationId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('rejects users without an organization membership', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.findAllForOrganization('user-id', 'organization-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.workspace.findMany).not.toHaveBeenCalled();
  });
});
