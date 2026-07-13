import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GitHubPullRequestState,
  ProviderConnectionStatus,
  PullRequestReviewStatus,
} from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConnectionOptions, Queue, Worker } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';
import { GithubAppService } from '../provider-connections/github-app.service';
import { OllamaGenerationService } from '../repositories/ollama-generation.service';

interface PullRequestPayload {
  action: string;
  number: number;
  installation?: { id: number };
  repository: { id: number; full_name: string };
  pull_request: {
    title: string;
    html_url: string;
    state: 'open' | 'closed';
    user?: { login: string };
    base: { sha: string };
    head: { sha: string };
  };
}

interface ReviewJobData {
  runId: string;
}

type ReviewQueue = Queue<ReviewJobData, void, 'review-pull-request'>;
type ReviewWorker = Worker<ReviewJobData, void, 'review-pull-request'>;

@Injectable()
export class GithubWebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GithubWebhookService.name);
  private queue?: ReviewQueue;
  private worker?: ReviewWorker;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly githubAppService: GithubAppService,
    private readonly ollamaGenerationService: OllamaGenerationService,
  ) {}

  onModuleInit() {
    if (this.configService.get<string>('NODE_ENV') === 'test') return;

    const redisUrl =
      this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const connection = this.createConnectionOptions(redisUrl);
    this.queue = new Queue<ReviewJobData, void, 'review-pull-request'>(
      'pull-request-reviews',
      {
        connection,
        defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 },
      },
    );
    this.worker = new Worker<ReviewJobData, void, 'review-pull-request'>(
      'pull-request-reviews',
      (job) => this.processRun(job.data.runId).then(() => undefined),
      { connection, concurrency: 1 },
    );
    this.worker.on('error', (error) => {
      this.logger.error(`Pull request review worker error: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException(
        'GITHUB_WEBHOOK_SECRET is not configured',
      );
    }
    if (!rawBody || !signature?.startsWith('sha256=')) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }

    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
  }

  async handleEvent(
    event: string | undefined,
    deliveryId: string | undefined,
    payload: unknown,
  ) {
    if (event === 'ping') return { message: 'GitHub webhook verified' };
    if (event !== 'pull_request') {
      return { message: 'GitHub webhook event ignored' };
    }
    if (!deliveryId) {
      throw new UnauthorizedException('GitHub delivery ID is missing');
    }

    const pullRequestPayload = payload as PullRequestPayload;
    if (
      !['opened', 'reopened', 'synchronize'].includes(pullRequestPayload.action)
    ) {
      return { message: 'Pull request action ignored' };
    }
    const installationId = pullRequestPayload.installation?.id;
    const repositoryExternalId = pullRequestPayload.repository?.id;
    const pullRequestNumber = pullRequestPayload.number;
    const headSha = pullRequestPayload.pull_request?.head?.sha;
    if (
      !installationId ||
      !repositoryExternalId ||
      !Number.isInteger(pullRequestNumber) ||
      !headSha
    ) {
      throw new UnauthorizedException('Invalid GitHub pull request payload');
    }
    if (!this.queue) {
      throw new ServiceUnavailableException(
        'Pull request review queue is unavailable',
      );
    }

    const repositories = await this.prisma.repository.findMany({
      where: {
        externalId: String(repositoryExternalId),
        providerConnection: {
          installationId: String(installationId),
          status: ProviderConnectionStatus.ACTIVE,
        },
      },
      select: { id: true },
    });
    if (repositories.length === 0) {
      return { message: 'Pull request repository is not imported' };
    }

    let queued = 0;
    let duplicate = 0;
    for (const repository of repositories) {
      const pullRequest = await this.prisma.gitHubPullRequest.upsert({
        where: {
          repositoryId_number: {
            repositoryId: repository.id,
            number: pullRequestNumber,
          },
        },
        create: {
          repositoryId: repository.id,
          number: pullRequestNumber,
          title: pullRequestPayload.pull_request.title,
          url: pullRequestPayload.pull_request.html_url,
          authorLogin: pullRequestPayload.pull_request.user?.login,
          baseSha: pullRequestPayload.pull_request.base.sha,
          headSha,
          state: GitHubPullRequestState.OPEN,
        },
        update: {
          title: pullRequestPayload.pull_request.title,
          url: pullRequestPayload.pull_request.html_url,
          authorLogin: pullRequestPayload.pull_request.user?.login,
          baseSha: pullRequestPayload.pull_request.base.sha,
          headSha,
          state: GitHubPullRequestState.OPEN,
        },
      });
      const existing = await this.prisma.pullRequestReviewRun.findUnique({
        where: {
          pullRequestId_headSha: { pullRequestId: pullRequest.id, headSha },
        },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== PullRequestReviewStatus.FAILED) {
        duplicate += 1;
        continue;
      }

      const run = existing
        ? await this.prisma.pullRequestReviewRun.update({
            where: { id: existing.id },
            data: {
              deliveryId,
              status: PullRequestReviewStatus.QUEUED,
              errorMessage: null,
              startedAt: null,
              completedAt: null,
            },
            select: { id: true },
          })
        : await this.prisma.pullRequestReviewRun.create({
            data: {
              repositoryId: repository.id,
              pullRequestId: pullRequest.id,
              deliveryId,
              headSha,
            },
            select: { id: true },
          });

      try {
        await this.queue.add(
          'review-pull-request',
          { runId: run.id },
          { jobId: run.id },
        );
        queued += 1;
      } catch (error: unknown) {
        await this.failRun(run.id, error);
        throw new ServiceUnavailableException(
          'Pull request review could not be queued',
        );
      }
    }

    return {
      message: queued
        ? 'Pull request review queued'
        : 'Pull request commit was already reviewed',
      queued,
      duplicate,
    };
  }

  async processRun(runId: string) {
    await this.prisma.pullRequestReviewRun.update({
      where: { id: runId },
      data: {
        status: PullRequestReviewStatus.RUNNING,
        errorMessage: null,
        startedAt: new Date(),
        completedAt: null,
      },
    });

    try {
      const run = await this.prisma.pullRequestReviewRun.findUnique({
        where: { id: runId },
        include: {
          pullRequest: true,
          repository: {
            select: {
              fullName: true,
              providerConnection: {
                select: { installationId: true, status: true },
              },
            },
          },
        },
      });
      const installationId = run?.repository.providerConnection?.installationId;
      if (
        !run ||
        !installationId ||
        run.repository.providerConnection?.status !==
          ProviderConnectionStatus.ACTIVE
      ) {
        throw new NotFoundException('Active GitHub repository not found');
      }
      if (run.pullRequest.headSha !== run.headSha) {
        return this.prisma.pullRequestReviewRun.update({
          where: { id: runId },
          data: {
            status: PullRequestReviewStatus.SKIPPED,
            errorMessage: 'A newer pull request commit superseded this run',
            completedAt: new Date(),
          },
        });
      }

      const changed = await this.githubAppService.getPullRequestSources(
        installationId,
        run.repository.fullName,
        run.pullRequest.number,
      );
      const generated = await this.ollamaGenerationService.reviewCode(
        changed.sources,
      );
      const body = this.createReviewBody(
        generated.reviews,
        changed.sources.length,
        changed.changedFiles,
        generated.model,
      );
      const posted = await this.githubAppService.createPullRequestReview(
        installationId,
        run.repository.fullName,
        run.pullRequest.number,
        run.headSha,
        body,
      );

      return this.prisma.pullRequestReviewRun.update({
        where: { id: runId },
        data: {
          status: PullRequestReviewStatus.COMPLETED,
          model: generated.model,
          filesReviewed: changed.sources.length,
          issuesFound: generated.reviews.length,
          githubReviewId: posted.id,
          githubReviewUrl: posted.url,
          errorMessage: null,
          completedAt: new Date(),
        },
      });
    } catch (error: unknown) {
      await this.failRun(runId, error);
      throw error;
    }
  }

  async findLatest(userId: string, workspaceId: string, repositoryId: string) {
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
      select: { id: true },
    });
    if (!repository) throw new NotFoundException('Repository not found');

    return {
      run: await this.prisma.pullRequestReviewRun.findFirst({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
        select: this.runSelect,
      }),
    };
  }

  private createReviewBody(
    reviews: Array<{
      title: string;
      description: string;
      severity: string;
      filePath: string;
      startLine: number;
      endLine: number;
      suggestion: string | null;
    }>,
    filesReviewed: number,
    changedFiles: number,
    model: string,
  ) {
    const safeModel = this.sanitizeReviewText(model, true).replace(/`/g, "'");
    const header = `## NexusDevAI local review\n\nReviewed ${filesReviewed} of ${changedFiles} changed files with \`${safeModel}\`.`;
    if (filesReviewed === 0) {
      return `${header}\n\nNo supported changed source regions were available to review.`;
    }
    if (reviews.length === 0) {
      return `${header}\n\nNo concrete correctness, security, or serious performance defects were found.`;
    }
    const findings = reviews.map((review, index) => {
      const title = this.sanitizeReviewText(review.title, true);
      const description = this.sanitizeReviewText(review.description);
      const location = this.sanitizeReviewText(
        `${review.filePath}:${review.startLine}-${review.endLine}`,
        true,
      ).replace(/`/g, "'");
      const suggestion = review.suggestion
        ? `\n\nSuggested fix: ${this.sanitizeReviewText(review.suggestion)}`
        : '';
      return `### ${index + 1}. [${review.severity}] ${title}\n\n\`${location}\` — ${description}${suggestion}`;
    });
    return `${header}\n\n${findings.join('\n\n')}`.slice(0, 60_000);
  }

  private sanitizeReviewText(value: string, singleLine = false) {
    const sanitized = Array.from(
      value.replace(/\r/g, '').replace(/@/g, '@\u200b'),
    )
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code === 9 || code === 10 || (code >= 32 && code !== 127);
      })
      .join('');
    return (singleLine ? sanitized.replace(/\s*\n+\s*/g, ' ') : sanitized)
      .trim()
      .slice(0, 4000);
  }

  private failRun(runId: string, error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Pull request review failed';
    return this.prisma.pullRequestReviewRun.update({
      where: { id: runId },
      data: {
        status: PullRequestReviewStatus.FAILED,
        errorMessage: message.slice(0, 2000),
        completedAt: new Date(),
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

  private readonly runSelect = {
    id: true,
    repositoryId: true,
    headSha: true,
    status: true,
    model: true,
    filesReviewed: true,
    issuesFound: true,
    errorMessage: true,
    githubReviewUrl: true,
    startedAt: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
    pullRequest: {
      select: { number: true, title: true, url: true, authorLogin: true },
    },
  } as const;
}
