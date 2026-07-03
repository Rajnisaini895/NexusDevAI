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
    const tamperedState = `${state.slice(0, -1)}x`;

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
});
