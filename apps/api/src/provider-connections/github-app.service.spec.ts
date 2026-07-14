import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { GithubAppService } from './github-app.service';

describe('GithubAppService', () => {
  let service: GithubAppService;

  const configuration: Record<string, string> = {
    GITHUB_APP_SLUG: 'nexusdev-ai',
    GITHUB_STATE_SECRET: 'state-secret',
    JWT_SECRET: 'jwt-secret',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubAppService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((name: string) => configuration[name]),
          },
        },
      ],
    }).compile();

    service = module.get<GithubAppService>(GithubAppService);
  });

  it('creates a signed installation URL scoped to user and organization', () => {
    const result = service.createInstallUrl('organization-id', 'user-id');
    const url = new URL(result.installUrl);
    const state = url.searchParams.get('state');

    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/apps/nexusdev-ai/installations/new');
    expect(state).toBeTruthy();
    expect(() =>
      service.verifyState(state ?? '', 'organization-id', 'user-id'),
    ).not.toThrow();
  });

  it('rejects a setup state used for another organization', () => {
    const result = service.createInstallUrl('organization-id', 'user-id');
    const state = new URL(result.installUrl).searchParams.get('state') ?? '';

    expect(() =>
      service.verifyState(state, 'other-organization-id', 'user-id'),
    ).toThrow(BadRequestException);
  });

  it('rejects a tampered setup state', () => {
    const result = service.createInstallUrl('organization-id', 'user-id');
    const state = new URL(result.installUrl).searchParams.get('state') ?? '';
    const [payload, signature] = state.split('.');
    const replacement = signature.startsWith('A') ? 'B' : 'A';
    const tamperedState = `${payload}.${replacement}${signature.slice(1)}`;

    expect(() =>
      service.verifyState(tamperedState, 'organization-id', 'user-id'),
    ).toThrow(BadRequestException);
  });

  it('maps GitHub branches and commits into repository metadata', async () => {
    jest
      .spyOn(service as never, 'createInstallationToken' as never)
      .mockResolvedValue({ token: 'installation-token' } as never);
    const request = jest.spyOn(service as never, 'request' as never);
    request
      .mockResolvedValueOnce([
        { name: 'main', commit: { sha: 'branch-sha' } },
      ] as never)
      .mockResolvedValueOnce([
        {
          sha: 'commit-sha',
          html_url: 'https://github.com/acme/project/commit/commit-sha',
          commit: {
            message: 'feat: sync repository',
            author: {
              name: 'Rajni',
              email: 'rajni@example.com',
              date: '2026-07-03T00:00:00.000Z',
            },
            committer: { date: '2026-07-03T00:00:00.000Z' },
          },
        },
      ] as never);

    await expect(
      service.getRepositoryMetadata('98765', 'acme/project', 'main'),
    ).resolves.toEqual({
      branches: [{ name: 'main', sha: 'branch-sha', isDefault: true }],
      commits: [
        {
          sha: 'commit-sha',
          message: 'feat: sync repository',
          authorName: 'Rajni',
          authorEmail: 'rajni@example.com',
          committedAt: new Date('2026-07-03T00:00:00.000Z'),
          url: 'https://github.com/acme/project/commit/commit-sha',
        },
      ],
    });
  });

  it('ingests supported source files while excluding secrets and binaries', async () => {
    jest
      .spyOn(service as never, 'createInstallationToken' as never)
      .mockResolvedValue({ token: 'installation-token' } as never);
    const request = jest.spyOn(service as never, 'request' as never);
    request
      .mockResolvedValueOnce({
        truncated: false,
        tree: [
          {
            path: 'src/main.ts',
            type: 'blob',
            mode: '100644',
            sha: 'source-sha',
            size: 24,
          },
          {
            path: '.env',
            type: 'blob',
            mode: '100644',
            sha: 'secret-sha',
            size: 20,
          },
          {
            path: 'logo.png',
            type: 'blob',
            mode: '100644',
            sha: 'image-sha',
            size: 200,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        content: Buffer.from('export const ready = true;').toString('base64'),
        encoding: 'base64',
        size: 26,
      } as never);

    await expect(
      service.getRepositoryFiles('98765', 'acme/project', 'main'),
    ).resolves.toEqual({
      files: [
        {
          path: 'src/main.ts',
          sha: 'source-sha',
          size: 26,
          language: 'TypeScript',
          content: 'export const ready = true;',
        },
      ],
      skipped: 2,
      limited: false,
    });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('builds bounded review sources around added pull request lines', async () => {
    jest
      .spyOn(service as never, 'createInstallationToken' as never)
      .mockResolvedValue({ token: 'installation-token' } as never);
    const request = jest.spyOn(service as never, 'request' as never);
    const source = Array.from(
      { length: 80 },
      (_, index) => `export const line${index + 1} = ${index + 1};`,
    ).join('\n');
    request
      .mockResolvedValueOnce([
        {
          sha: 'blob-sha',
          filename: 'src/main.ts',
          status: 'modified',
          additions: 2,
          deletions: 1,
          changes: 3,
          patch:
            '@@ -39,3 +39,4 @@\n export const line39 = 39;\n-export const line40 = 0;\n+export const line40 = 40;\n+export const line41 = 41;\n export const line42 = 42;',
        },
        {
          sha: 'secret-sha',
          filename: '.env',
          status: 'modified',
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: '@@ -1 +1 @@\n+TOKEN=secret',
        },
      ] as never)
      .mockResolvedValueOnce({
        content: Buffer.from(source).toString('base64'),
        encoding: 'base64',
        size: Buffer.byteLength(source),
      } as never);

    const result = await service.getPullRequestSources(
      '98765',
      'acme/project',
      12,
    );

    expect(result.changedFiles).toBe(2);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      path: 'src/main.ts',
      startLine: 20,
      endLine: 61,
    });
    expect(result.sources[0].content).toContain('export const line40 = 40;');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('posts a commit-scoped pull request review comment', async () => {
    jest
      .spyOn(service as never, 'createInstallationToken' as never)
      .mockResolvedValue({ token: 'installation-token' } as never);
    const request = jest
      .spyOn(service as never, 'request' as never)
      .mockResolvedValue({
        id: 42,
        html_url: 'https://github.com/acme/project/pull/12#review-42',
      } as never);

    await expect(
      service.createPullRequestReview(
        '98765',
        'acme/project',
        12,
        'head-sha',
        'No defects found.',
      ),
    ).resolves.toEqual({
      id: '42',
      url: 'https://github.com/acme/project/pull/12#review-42',
    });
    expect(request).toHaveBeenCalledWith(
      '/repos/acme/project/pulls/12/reviews',
      'installation-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          commit_id: 'head-sha',
          body: 'No defects found.',
          event: 'COMMENT',
        }),
      }),
    );
  });

  it('creates and completes a GitHub check run for a pull request head', async () => {
    jest
      .spyOn(service as never, 'createInstallationToken' as never)
      .mockResolvedValue({ token: 'installation-token' } as never);
    const request = jest.spyOn(service as never, 'request' as never);
    request
      .mockResolvedValueOnce({
        id: 21,
        html_url: 'https://github.com/acme/project/runs/21',
      } as never)
      .mockResolvedValueOnce({
        id: 21,
        html_url: 'https://github.com/acme/project/runs/21',
      } as never);

    await expect(
      service.createPullRequestCheckRun(
        '98765',
        'acme/project',
        'head-sha',
        'https://github.com/acme/project/pull/12',
      ),
    ).resolves.toEqual({
      id: '21',
      url: 'https://github.com/acme/project/runs/21',
    });
    const requestCalls = request.mock.calls as unknown as Array<
      [string, string, RequestInit]
    >;
    expect(requestCalls[0]?.[0]).toBe('/repos/acme/project/check-runs');
    expect(requestCalls[0]?.[1]).toBe('installation-token');
    expect(requestCalls[0]?.[2].method).toBe('POST');
    const createBody = requestCalls[0]?.[2].body;
    if (typeof createBody !== 'string') throw new Error('Missing check body');
    expect(createBody).toContain('"status":"in_progress"');

    await expect(
      service.completePullRequestCheckRun(
        '98765',
        'acme/project',
        '21',
        'success',
        'No validated issues found',
        'Reviewed one changed file.',
      ),
    ).resolves.toEqual({
      id: '21',
      url: 'https://github.com/acme/project/runs/21',
    });
    expect(requestCalls[1]?.[0]).toBe('/repos/acme/project/check-runs/21');
    expect(requestCalls[1]?.[1]).toBe('installation-token');
    expect(requestCalls[1]?.[2].method).toBe('PATCH');
    const completeBody = requestCalls[1]?.[2].body;
    if (typeof completeBody !== 'string') {
      throw new Error('Missing completed check body');
    }
    expect(completeBody).toContain('"conclusion":"success"');
  });
});
