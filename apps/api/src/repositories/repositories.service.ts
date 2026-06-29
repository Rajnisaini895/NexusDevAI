import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';

@Injectable()
export class RepositoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    workspaceId: string,
    createRepositoryDto: CreateRepositoryDto,
  ) {
    const membership = await this.findWorkspaceMembership(userId, workspaceId);

    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot add repositories');
    }

    try {
      const repository = await this.prisma.repository.create({
        data: {
          name: createRepositoryDto.name.trim(),
          fullName: createRepositoryDto.fullName.trim(),
          provider: createRepositoryDto.provider,
          externalId: createRepositoryDto.externalId?.trim(),
          defaultBranch: createRepositoryDto.defaultBranch?.trim(),
          workspaceId,
        },
        select: {
          id: true,
          name: true,
          fullName: true,
          provider: true,
          externalId: true,
          defaultBranch: true,
          workspaceId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        message: 'Repository created successfully',
        repository,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Repository already exists in this workspace',
        );
      }

      throw error;
    }
  }

  async findAll(userId: string, workspaceId: string) {
    await this.findWorkspaceMembership(userId, workspaceId);

    const repositories = await this.prisma.repository.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        fullName: true,
        provider: true,
        externalId: true,
        defaultBranch: true,
        workspaceId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { repositories };
  }

  async findOne(userId: string, workspaceId: string, repositoryId: string) {
    await this.findWorkspaceMembership(userId, workspaceId);

    const repository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
      },
      select: {
        id: true,
        name: true,
        fullName: true,
        provider: true,
        externalId: true,
        defaultBranch: true,
        workspaceId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    return { repository };
  }

  async remove(userId: string, workspaceId: string, repositoryId: string) {
    const membership = await this.findWorkspaceMembership(userId, workspaceId);

    if (
      membership.role !== MemberRole.OWNER &&
      membership.role !== MemberRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Only organization owners and admins can remove repositories',
      );
    }

    const repository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
      },
      select: { id: true },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    await this.prisma.repository.delete({
      where: { id: repository.id },
    });

    return { message: 'Repository removed successfully' };
  }

  private async findWorkspaceMembership(userId: string, workspaceId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        deletedAt: null,
        organization: { deletedAt: null },
      },
      select: { organizationId: true },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        organizationId: workspace.organizationId,
      },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    return membership;
  }
}
