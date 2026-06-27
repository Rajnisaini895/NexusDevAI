import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationMembersService } from './organization-members.service';

describe('OrganizationMembersService', () => {
  let service: OrganizationMembersService;

  const prisma = {
    membership: {
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationMembersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<OrganizationMembersService>(
      OrganizationMembersService,
    );
  });

  it('allows an organization member to list members', async () => {
    const members = [
      {
        id: 'membership-id',
        role: MemberRole.OWNER,
        createdAt: new Date('2026-06-27T00:00:00.000Z'),
        user: {
          id: 'user-id',
          email: 'owner@nexusdev.ai',
          fullName: 'Organization Owner',
          status: 'ACTIVE',
        },
      },
    ];
    prisma.membership.findFirst.mockResolvedValue({
      id: 'actor-membership-id',
      role: MemberRole.VIEWER,
    });
    prisma.membership.findMany.mockResolvedValue(members);

    await expect(
      service.findAll('user-id', 'organization-id'),
    ).resolves.toEqual({ members });
  });

  it('adds an active user as an organization member', async () => {
    prisma.membership.findFirst.mockResolvedValue({
      id: 'actor-membership-id',
      role: MemberRole.OWNER,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'new-user-id',
      email: 'developer@nexusdev.ai',
      fullName: 'Nexus Developer',
      status: 'ACTIVE',
      deletedAt: null,
    });
    prisma.membership.create.mockResolvedValue({
      id: 'new-membership-id',
      role: MemberRole.DEVELOPER,
      createdAt: new Date('2026-06-27T00:00:00.000Z'),
    });

    const result = await service.add('owner-id', 'organization-id', {
      email: 'Developer@NexusDev.ai',
      role: MemberRole.DEVELOPER,
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'developer@nexusdev.ai' },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        deletedAt: true,
      },
    });
    expect(prisma.membership.create).toHaveBeenCalledWith({
      data: {
        userId: 'new-user-id',
        organizationId: 'organization-id',
        role: MemberRole.DEVELOPER,
      },
      select: {
        id: true,
        role: true,
        createdAt: true,
      },
    });
    expect(result.member.user.email).toBe('developer@nexusdev.ai');
  });

  it('prevents an admin from creating an owner membership', async () => {
    prisma.membership.findFirst.mockResolvedValue({
      id: 'actor-membership-id',
      role: MemberRole.ADMIN,
    });

    await expect(
      service.add('admin-id', 'organization-id', {
        email: 'developer@nexusdev.ai',
        role: MemberRole.OWNER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('prevents removal of the last organization owner', async () => {
    prisma.membership.findFirst
      .mockResolvedValueOnce({
        id: 'actor-membership-id',
        role: MemberRole.OWNER,
      })
      .mockResolvedValueOnce({
        id: 'target-membership-id',
        userId: 'owner-id',
        role: MemberRole.OWNER,
      });
    prisma.membership.count.mockResolvedValue(0);

    await expect(
      service.remove('owner-id', 'organization-id', 'target-membership-id'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.membership.delete).not.toHaveBeenCalled();
  });

  it('allows an owner to update a member role', async () => {
    prisma.membership.findFirst
      .mockResolvedValueOnce({
        id: 'actor-membership-id',
        role: MemberRole.OWNER,
      })
      .mockResolvedValueOnce({
        id: 'target-membership-id',
        userId: 'developer-id',
        role: MemberRole.DEVELOPER,
      });
    prisma.membership.update.mockResolvedValue({
      id: 'target-membership-id',
      role: MemberRole.ADMIN,
      createdAt: new Date('2026-06-27T00:00:00.000Z'),
      user: {
        id: 'developer-id',
        email: 'developer@nexusdev.ai',
        fullName: 'Nexus Developer',
        status: 'ACTIVE',
      },
    });

    const result = await service.updateRole(
      'owner-id',
      'organization-id',
      'target-membership-id',
      { role: MemberRole.ADMIN },
    );

    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: { id: 'target-membership-id' },
      data: { role: MemberRole.ADMIN },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
          },
        },
      },
    });
    expect(result.member.role).toBe(MemberRole.ADMIN);
  });
});
