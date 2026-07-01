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
});
