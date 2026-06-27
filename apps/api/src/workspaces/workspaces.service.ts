import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    organizationId: string,
    createWorkspaceDto: CreateWorkspaceDto,
  ) {
    const membership = await this.findMembership(userId, organizationId);

    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Only organization owners and admins can create workspaces',
      );
    }

    const name = createWorkspaceDto.name.trim();
    const slug = createWorkspaceDto.slug ?? this.createSlug(name);

    if (!name || !slug) {
      throw new BadRequestException('Workspace name is required');
    }

    try {
      const workspace = await this.prisma.workspace.create({
        data: {
          name,
          slug,
          organizationId,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          organizationId: true,
          createdAt: true,
        },
      });

      return {
        message: 'Workspace created successfully',
        workspace,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Workspace slug is already in use for this organization',
        );
      }

      throw error;
    }
  }

  async findAllForOrganization(userId: string, organizationId: string) {
    await this.findMembership(userId, organizationId);

    const workspaces = await this.prisma.workspace.findMany({
      where: {
        organizationId,
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

    return { workspaces };
  }

  private async findMembership(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You do not have access to this organization',
      );
    }

    return membership;
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
