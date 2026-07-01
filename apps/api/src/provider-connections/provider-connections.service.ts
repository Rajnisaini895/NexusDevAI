import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GitProvider,
  MemberRole,
  ProviderConnectionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CompleteGithubConnectionDto } from './dto/complete-github-connection.dto';
import { GithubAppService } from './github-app.service';

@Injectable()
export class ProviderConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubAppService: GithubAppService,
  ) {}

  async createGithubInstallUrl(userId: string, organizationId: string) {
    await this.requireManager(userId, organizationId);
    return this.githubAppService.createInstallUrl(organizationId, userId);
  }

  async completeGithubConnection(
    userId: string,
    organizationId: string,
    dto: CompleteGithubConnectionDto,
  ) {
    await this.requireManager(userId, organizationId);
    this.githubAppService.verifyState(dto.state, organizationId, userId);

    const installation = await this.githubAppService.getInstallation(
      dto.installationId,
    );
    const installationId = String(installation.id);
    const externalAccountId = String(installation.account.id);

    const existingInstallation =
      await this.prisma.providerConnection.findUnique({
        where: { installationId },
      });

    if (
      existingInstallation &&
      existingInstallation.organizationId !== organizationId
    ) {
      throw new ConflictException(
        'GitHub installation is connected to another organization',
      );
    }

    const connection = existingInstallation
      ? await this.prisma.providerConnection.update({
          where: { id: existingInstallation.id },
          data: {
            accountLogin: installation.account.login,
            connectedByUserId: userId,
            status: installation.suspended_at
              ? ProviderConnectionStatus.SUSPENDED
              : ProviderConnectionStatus.ACTIVE,
            disconnectedAt: null,
          },
          select: this.connectionSelect,
        })
      : await this.upsertGithubAccountConnection(
          userId,
          organizationId,
          installationId,
          externalAccountId,
          installation.account.login,
          installation.suspended_at !== null,
        );

    return {
      message: 'GitHub connection completed successfully',
      connection,
    };
  }

  async findAll(userId: string, organizationId: string) {
    await this.requireMember(userId, organizationId);
    const connections = await this.prisma.providerConnection.findMany({
      where: { organizationId },
      select: this.connectionSelect,
      orderBy: { createdAt: 'asc' },
    });
    return { connections };
  }

  async discoverRepositories(
    userId: string,
    organizationId: string,
    connectionId: string,
  ) {
    await this.requireMember(userId, organizationId);
    const connection = await this.findActiveGithubConnection(
      organizationId,
      connectionId,
    );
    const repositories =
      await this.githubAppService.listInstallationRepositories(
        connection.installationId,
      );
    return { repositories };
  }

  async disconnect(
    userId: string,
    organizationId: string,
    connectionId: string,
  ) {
    await this.requireManager(userId, organizationId);
    const connection = await this.prisma.providerConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { id: true },
    });

    if (!connection) {
      throw new NotFoundException('Provider connection not found');
    }

    await this.prisma.providerConnection.update({
      where: { id: connection.id },
      data: {
        status: ProviderConnectionStatus.DISCONNECTED,
        disconnectedAt: new Date(),
      },
    });

    return { message: 'Provider connection disconnected successfully' };
  }

  private async upsertGithubAccountConnection(
    userId: string,
    organizationId: string,
    installationId: string,
    externalAccountId: string,
    accountLogin: string,
    suspended: boolean,
  ) {
    return this.prisma.providerConnection.upsert({
      where: {
        organizationId_provider_externalAccountId: {
          organizationId,
          provider: GitProvider.GITHUB,
          externalAccountId,
        },
      },
      create: {
        organizationId,
        connectedByUserId: userId,
        provider: GitProvider.GITHUB,
        externalAccountId,
        accountLogin,
        installationId,
        status: suspended
          ? ProviderConnectionStatus.SUSPENDED
          : ProviderConnectionStatus.ACTIVE,
      },
      update: {
        connectedByUserId: userId,
        accountLogin,
        installationId,
        status: suspended
          ? ProviderConnectionStatus.SUSPENDED
          : ProviderConnectionStatus.ACTIVE,
        disconnectedAt: null,
      },
      select: this.connectionSelect,
    });
  }

  private async findActiveGithubConnection(
    organizationId: string,
    connectionId: string,
  ) {
    const connection = await this.prisma.providerConnection.findFirst({
      where: {
        id: connectionId,
        organizationId,
        provider: GitProvider.GITHUB,
        status: ProviderConnectionStatus.ACTIVE,
        installationId: { not: null },
      },
      select: { installationId: true },
    });

    if (!connection?.installationId) {
      throw new NotFoundException('Active GitHub connection not found');
    }

    return { installationId: connection.installationId };
  }

  private async requireMember(userId: string, organizationId: string) {
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

  private async requireManager(userId: string, organizationId: string) {
    const membership = await this.requireMember(userId, organizationId);

    if (
      membership.role !== MemberRole.OWNER &&
      membership.role !== MemberRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Only organization owners and admins can manage provider connections',
      );
    }
  }

  private readonly connectionSelect = {
    id: true,
    provider: true,
    externalAccountId: true,
    accountLogin: true,
    installationId: true,
    status: true,
    connectedByUserId: true,
    createdAt: true,
    updatedAt: true,
    disconnectedAt: true,
  } as const;
}
