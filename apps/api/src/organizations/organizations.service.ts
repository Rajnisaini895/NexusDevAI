import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, createOrganizationDto: CreateOrganizationDto) {
    const name = createOrganizationDto.name.trim();
    const slug = createOrganizationDto.slug ?? this.createSlug(name);

    if (!name || !slug) {
      throw new BadRequestException('Organization name is required');
    }

    try {
      const organization = await this.prisma.organization.create({
        data: {
          name,
          slug,
          memberships: {
            create: {
              userId,
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
            where: { userId },
            select: { role: true },
          },
        },
      });

      return {
        message: 'Organization created successfully',
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: organization.memberships[0].role,
          createdAt: organization.createdAt,
        },
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Organization slug is already in use');
      }

      throw error;
    }
  }

  async findAllForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId,
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

    return {
      organizations: memberships.map((membership) => ({
        ...membership.organization,
        role: membership.role,
      })),
    };
  }

  private createSlug(name: string) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '');
  }
}
