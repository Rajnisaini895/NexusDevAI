import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PullRequestReviewStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { GithubAppService } from '../provider-connections/github-app.service';
import { OllamaGenerationService } from '../repositories/ollama-generation.service';
import { GithubWebhookService } from './github-webhook.service';

interface ReviewUpdateArgs {
  where: { id: string };
  data: Record<string, unknown>;
}

describe('GithubWebhookService', () => {
  let service: GithubWebhookService;

  const prisma = {
    repository: { findFirst: jest.fn(), findMany: jest.fn() },
    gitHubPullRequest: { upsert: jest.fn() },
    pullRequestReviewRun: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const githubAppService = {
    getPullRequestSources: jest.fn(),
    createPullRequestReview: jest.fn(),
  };
  const ollamaGenerationService = { reviewCode: jest.fn() };
  const queue = { add: jest.fn() };
  const payload = {
    action: 'opened',
    number: 12,
    installation: { id: 98765 },
    repository: { id: 12345, full_name: 'acme/project' },
    pull_request: {
      title: 'Fix session refresh',
      html_url: 'https://github.com/acme/project/pull/12',
      state: 'open',
      user: { login: 'developer' },
      base: { sha: 'base-sha' },
      head: { sha: 'head-sha' },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: GithubAppService, useValue: githubAppService },
        {
          provide: OllamaGenerationService,
          useValue: ollamaGenerationService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((name: string) =>
              name === 'NODE_ENV'
                ? 'test'
                : name === 'GITHUB_WEBHOOK_SECRET'
                  ? 'webhook-secret'
                  : undefined,
            ),
          },
        },
      ],
    }).compile();
    service = module.get(GithubWebhookService);
    Reflect.set(service, 'queue', queue);

    prisma.repository.findMany.mockResolvedValue([{ id: 'repository-id' }]);
    prisma.gitHubPullRequest.upsert.mockResolvedValue({
      id: 'pull-request-id',
    });
    prisma.pullRequestReviewRun.findUnique.mockResolvedValue(null);
    prisma.pullRequestReviewRun.create.mockResolvedValue({ id: 'run-id' });
    prisma.pullRequestReviewRun.update.mockResolvedValue({ id: 'run-id' });
    queue.add.mockResolvedValue({ id: 'run-id' });
  });

  it('accepts a valid SHA-256 GitHub signature', () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac('sha256', 'webhook-secret').update(rawBody).digest('hex')}`;

    expect(() => service.verifySignature(rawBody, signature)).not.toThrow();
  });

  it('rejects a webhook with a mismatched signature', () => {
    expect(() =>
      service.verifySignature(Buffer.from('{}'), `sha256=${'0'.repeat(64)}`),
    ).toThrow(UnauthorizedException);
  });

  it('queues an imported pull request once per head commit', async () => {
    await expect(
      service.handleEvent('pull_request', 'delivery-id', payload),
    ).resolves.toEqual({
      message: 'Pull request review queued',
      queued: 1,
      duplicate: 0,
    });

    expect(prisma.repository.findMany).toHaveBeenCalledWith({
      where: {
        externalId: '12345',
        providerConnection: {
          installationId: '98765',
          status: 'ACTIVE',
        },
      },
      select: { id: true },
    });
    expect(prisma.pullRequestReviewRun.create).toHaveBeenCalledWith({
      data: {
        repositoryId: 'repository-id',
        pullRequestId: 'pull-request-id',
        deliveryId: 'delivery-id',
        headSha: 'head-sha',
      },
      select: { id: true },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'review-pull-request',
      { runId: 'run-id' },
      { jobId: 'run-id' },
    );
  });

  it('does not queue a duplicate head commit', async () => {
    prisma.pullRequestReviewRun.findUnique.mockResolvedValue({
      id: 'existing-run',
      status: PullRequestReviewStatus.COMPLETED,
    });

    await expect(
      service.handleEvent('pull_request', 'delivery-id', payload),
    ).resolves.toEqual({
      message: 'Pull request commit was already reviewed',
      queued: 0,
      duplicate: 1,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('reviews changed sources and posts a GitHub summary', async () => {
    prisma.pullRequestReviewRun.findUnique.mockResolvedValue({
      id: 'run-id',
      headSha: 'head-sha',
      pullRequest: {
        number: 12,
        headSha: 'head-sha',
      },
      repository: {
        fullName: 'acme/project',
        providerConnection: { installationId: '98765', status: 'ACTIVE' },
      },
    });
    githubAppService.getPullRequestSources.mockResolvedValue({
      sources: [
        {
          path: 'src/auth.ts',
          startLine: 10,
          endLine: 30,
          content: 'export function refresh() {}',
        },
      ],
      changedFiles: 2,
      eligibleFiles: 1,
    });
    ollamaGenerationService.reviewCode.mockResolvedValue({
      model: 'qwen2.5-coder:7b',
      reviews: [
        {
          title: 'Refresh token is reused',
          description: 'The old token remains valid after refresh.',
          severity: 'HIGH',
          filePath: 'src/auth.ts',
          startLine: 14,
          endLine: 18,
          suggestion: 'Revoke the old token in the same transaction.',
        },
      ],
    });
    githubAppService.createPullRequestReview.mockResolvedValue({
      id: '42',
      url: 'https://github.com/acme/project/pull/12#review-42',
    });

    await service.processRun('run-id');

    expect(githubAppService.createPullRequestReview).toHaveBeenCalledWith(
      '98765',
      'acme/project',
      12,
      'head-sha',
      expect.stringContaining('[HIGH] Refresh token is reused'),
    );
    const updateMock = prisma.pullRequestReviewRun
      .update as jest.MockedFunction<
      (args: ReviewUpdateArgs) => Promise<unknown>
    >;
    const finalUpdate = updateMock.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      where: { id: 'run-id' },
      data: {
        status: PullRequestReviewStatus.COMPLETED,
        model: 'qwen2.5-coder:7b',
        filesReviewed: 1,
        issuesFound: 1,
        githubReviewId: '42',
      },
    });
  });
});
