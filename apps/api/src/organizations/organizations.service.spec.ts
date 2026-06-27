import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  const prisma = {
    organization: {
      create: jest.fn(),
    },
    membership: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  it('creates an organization and owner membership atomically', async () => {
    const createdAt = new Date('2026-06-27T00:00:00.000Z');
    prisma.organization.create.mockResolvedValue({
      id: 'organization-id',
      name: 'Nexus Engineering',
      slug: 'nexus-engineering',
      createdAt,
      memberships: [{ role: 'OWNER' }],
    });

    const result = await service.create('user-id', {
      name: '  Nexus Engineering  ',
    });

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: {
        name: 'Nexus Engineering',
        slug: 'nexus-engineering',
        memberships: {
          create: {
            userId: 'user-id',
            role: 'OWNER',
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        memberships: {
          where: { userId: 'user-id' },
          select: { role: true },
        },
      },
    });
    expect(result).toEqual({
      message: 'Organization created successfully',
      organization: {
        id: 'organization-id',
        name: 'Nexus Engineering',
        slug: 'nexus-engineering',
        role: 'OWNER',
        createdAt,
      },
    });
  });

  it('returns only organizations belonging to the authenticated user', async () => {
    const createdAt = new Date('2026-06-27T00:00:00.000Z');
    prisma.membership.findMany.mockResolvedValue([
      {
        role: 'DEVELOPER',
        organization: {
          id: 'organization-id',
          name: 'Nexus Engineering',
          slug: 'nexus-engineering',
          createdAt,
        },
      },
    ]);

    const result = await service.findAllForUser('user-id');

    expect(prisma.membership.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        organization: { deletedAt: null },
      },
      select: {
        role: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(result.organizations).toEqual([
      {
        id: 'organization-id',
        name: 'Nexus Engineering',
        slug: 'nexus-engineering',
        createdAt,
        role: 'DEVELOPER',
      },
    ]);
  });
});
