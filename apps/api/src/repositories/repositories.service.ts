import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GitProvider,
  MemberRole,
  Prisma,
  ProviderConnectionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { GithubAppService } from '../provider-connections/github-app.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { ImportRepositoryDto } from './dto/import-repository.dto';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubAppService: GithubAppService,
  ) {}

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
        select: this.repositorySelect,
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

  async importFromGithub(
    userId: string,
    workspaceId: string,
    importRepositoryDto: ImportRepositoryDto,
  ) {
    const membership = await this.findWorkspaceMembership(userId, workspaceId);

    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot import repositories');
    }

    const connection = await this.prisma.providerConnection.findFirst({
      where: {
        id: importRepositoryDto.connectionId,
        organizationId: membership.organizationId,
        provider: GitProvider.GITHUB,
        status: ProviderConnectionStatus.ACTIVE,
        installationId: { not: null },
      },
      select: { id: true, installationId: true },
    });

    if (!connection?.installationId) {
      throw new NotFoundException('Active GitHub connection not found');
    }

    const availableRepositories =
      await this.githubAppService.listInstallationRepositories(
        connection.installationId,
      );
    const githubRepository = availableRepositories.find(
      (repository) =>
        repository.externalId ===
        importRepositoryDto.externalRepositoryId.trim(),
    );

    if (!githubRepository) {
      throw new NotFoundException(
        'Repository is not available through this GitHub connection',
      );
    }

    try {
      const repository = await this.prisma.repository.create({
        data: {
          name: githubRepository.name,
          fullName: githubRepository.fullName,
          provider: GitProvider.GITHUB,
          externalId: githubRepository.externalId,
          defaultBranch: githubRepository.defaultBranch,
          url: githubRepository.url,
          isPrivate: githubRepository.private,
          workspaceId,
          providerConnectionId: connection.id,
        },
        select: this.repositorySelect,
      });

      return {
        message: 'Repository imported successfully',
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
      select: this.repositorySelect,
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
      select: this.repositorySelect,
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

  async synchronize(userId: string, workspaceId: string, repositoryId: string) {
    const membership = await this.findWorkspaceMembership(userId, workspaceId);

    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot synchronize repositories');
    }

    const repository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
        provider: GitProvider.GITHUB,
        providerConnection: {
          organizationId: membership.organizationId,
          status: ProviderConnectionStatus.ACTIVE,
          installationId: { not: null },
        },
      },
      select: {
        id: true,
        fullName: true,
        defaultBranch: true,
        providerConnection: { select: { installationId: true } },
      },
    });

    const installationId = repository?.providerConnection?.installationId;

    if (!repository || !installationId || !repository.defaultBranch) {
      throw new NotFoundException('Synchronizable GitHub repository not found');
    }

    const metadata = await this.githubAppService.getRepositoryMetadata(
      installationId,
      repository.fullName,
      repository.defaultBranch,
    );

    await this.prisma.$transaction([
      ...metadata.branches.map((branch) =>
        this.prisma.repositoryBranch.upsert({
          where: {
            repositoryId_name: {
              repositoryId: repository.id,
              name: branch.name,
            },
          },
          create: { repositoryId: repository.id, ...branch },
          update: {
            sha: branch.sha,
            isDefault: branch.isDefault,
          },
        }),
      ),
      ...metadata.commits.map((commit) =>
        this.prisma.repositoryCommit.upsert({
          where: {
            repositoryId_sha: { repositoryId: repository.id, sha: commit.sha },
          },
          create: { repositoryId: repository.id, ...commit },
          update: {
            message: commit.message,
            authorName: commit.authorName,
            authorEmail: commit.authorEmail,
            committedAt: commit.committedAt,
            url: commit.url,
          },
        }),
      ),
    ]);

    return {
      message: 'Repository synchronized successfully',
      synchronized: {
        branches: metadata.branches.length,
        commits: metadata.commits.length,
      },
    };
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

    return { ...membership, organizationId: workspace.organizationId };
  }

  private readonly repositorySelect = {
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
      select: { branches: true, commits: true },
    },
    createdAt: true,
    updatedAt: true,
  } as const;
}
