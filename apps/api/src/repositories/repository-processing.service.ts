import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MemberRole,
  RepositoryProcessingStage,
  RepositoryProcessingStatus,
} from '@prisma/client';
import { ConnectionOptions, Queue, Worker } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';
import { RepositoriesService } from './repositories.service';

interface ProcessingJobData {
  runId: string;
  userId: string;
  workspaceId: string;
  repositoryId: string;
}

type ProcessingQueue = Queue<ProcessingJobData, void, 'prepare-repository'>;
type ProcessingWorker = Worker<ProcessingJobData, void, 'prepare-repository'>;

@Injectable()
export class RepositoryProcessingService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RepositoryProcessingService.name);
  private queue?: ProcessingQueue;
  private worker?: ProcessingWorker;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly repositoriesService: RepositoriesService,
  ) {}

  onModuleInit() {
    if (this.configService.get<string>('NODE_ENV') === 'test') return;

    const redisUrl =
      this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const connection = this.createConnectionOptions(redisUrl);
    this.queue = new Queue<ProcessingJobData, void, 'prepare-repository'>(
      'repository-processing',
      {
        connection,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      },
    );
    this.worker = new Worker<ProcessingJobData, void, 'prepare-repository'>(
      'repository-processing',
      (job) => this.processRun(job.data).then(() => undefined),
      { connection, concurrency: 1 },
    );
    this.worker.on('error', (error) => {
      this.logger.error(`Repository processing worker error: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(userId: string, workspaceId: string, repositoryId: string) {
    if (!this.queue) {
      throw new ServiceUnavailableException(
        'Repository processing queue is unavailable',
      );
    }
    await this.requireRepositoryAccess(userId, workspaceId, repositoryId, true);

    const activeRun = await this.prisma.repositoryProcessingRun.findFirst({
      where: {
        repositoryId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      orderBy: { createdAt: 'desc' },
      select: this.runSelect,
    });
    if (activeRun) {
      return {
        message: 'Repository processing is already running',
        run: activeRun,
      };
    }

    const run = await this.prisma.repositoryProcessingRun.create({
      data: {
        repositoryId,
        workspaceId,
        requestedByUserId: userId,
      },
      select: this.runSelect,
    });

    try {
      await this.queue.add(
        'prepare-repository',
        { runId: run.id, userId, workspaceId, repositoryId },
        { jobId: run.id },
      );
    } catch (error: unknown) {
      await this.failRun(run.id, error);
      throw new ServiceUnavailableException(
        'Repository processing could not be queued',
      );
    }

    return { message: 'Repository processing queued', run };
  }

  async findLatest(userId: string, workspaceId: string, repositoryId: string) {
    await this.requireRepositoryAccess(
      userId,
      workspaceId,
      repositoryId,
      false,
    );
    return {
      run: await this.prisma.repositoryProcessingRun.findFirst({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
        select: this.runSelect,
      }),
    };
  }

  async processRun(data: ProcessingJobData) {
    const { runId, userId, workspaceId, repositoryId } = data;
    try {
      await this.updateStage(
        runId,
        RepositoryProcessingStage.SYNCING,
        10,
        true,
      );
      await this.repositoriesService.synchronize(
        userId,
        workspaceId,
        repositoryId,
      );

      await this.updateStage(runId, RepositoryProcessingStage.INGESTING, 35);
      await this.repositoriesService.ingestFiles(
        userId,
        workspaceId,
        repositoryId,
      );

      await this.updateStage(runId, RepositoryProcessingStage.CHUNKING, 60);
      await this.repositoriesService.chunkFiles(
        userId,
        workspaceId,
        repositoryId,
      );

      await this.updateStage(runId, RepositoryProcessingStage.EMBEDDING, 80);
      await this.repositoriesService.embedChunks(
        userId,
        workspaceId,
        repositoryId,
      );

      return this.prisma.repositoryProcessingRun.update({
        where: { id: runId },
        data: {
          status: RepositoryProcessingStatus.COMPLETED,
          stage: RepositoryProcessingStage.COMPLETED,
          progress: 100,
          errorMessage: null,
          completedAt: new Date(),
        },
        select: this.runSelect,
      });
    } catch (error: unknown) {
      await this.failRun(runId, error);
      throw error;
    }
  }

  private updateStage(
    runId: string,
    stage: RepositoryProcessingStage,
    progress: number,
    starting = false,
  ) {
    return this.prisma.repositoryProcessingRun.update({
      where: { id: runId },
      data: {
        status: RepositoryProcessingStatus.RUNNING,
        stage,
        progress,
        errorMessage: null,
        ...(starting ? { startedAt: new Date(), completedAt: null } : {}),
      },
    });
  }

  private createConnectionOptions(redisUrl: string): ConnectionOptions {
    const url = new URL(redisUrl);
    const database = Number(url.pathname.replace(/^\//, '') || '0');
    return {
      host: url.hostname,
      port: Number(url.port || '6379'),
      username: url.username || undefined,
      password: url.password || undefined,
      db: Number.isInteger(database) ? database : 0,
      maxRetriesPerRequest: null,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }

  private failRun(runId: string, error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Repository processing failed';
    return this.prisma.repositoryProcessingRun.update({
      where: { id: runId },
      data: {
        status: RepositoryProcessingStatus.FAILED,
        stage: RepositoryProcessingStage.FAILED,
        errorMessage: errorMessage.slice(0, 2000),
        completedAt: new Date(),
      },
    });
  }

  private async requireRepositoryAccess(
    userId: string,
    workspaceId: string,
    repositoryId: string,
    requireWrite: boolean,
  ) {
    const repository = await this.prisma.repository.findFirst({
      where: {
        id: repositoryId,
        workspaceId,
        workspace: {
          deletedAt: null,
          organization: {
            deletedAt: null,
            memberships: { some: { userId } },
          },
        },
      },
      select: {
        id: true,
        workspace: {
          select: {
            organization: {
              select: {
                memberships: {
                  where: { userId },
                  select: { role: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!repository) throw new NotFoundException('Repository not found');

    const role = repository.workspace.organization.memberships[0]?.role;
    if (requireWrite && role === MemberRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot process repositories');
    }
  }

  private readonly runSelect = {
    id: true,
    repositoryId: true,
    status: true,
    stage: true,
    progress: true,
    errorMessage: true,
    startedAt: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
  } as const;
}
