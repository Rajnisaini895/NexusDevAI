import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createSign, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';

interface GithubInstallation {
  id: number;
  account: {
    id: number;
    login: string;
  };
  suspended_at: string | null;
}

interface GithubInstallationToken {
  token: string;
  expires_at: string;
}

interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
  html_url: string;
}

interface GithubRepositoryResponse {
  repositories: GithubRepository[];
}

interface GithubBranch {
  name: string;
  commit: { sha: string };
}

interface GithubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    } | null;
    committer: { date: string } | null;
  };
}

interface SetupState {
  organizationId: string;
  userId: string;
  expiresAt: number;
}

@Injectable()
export class GithubAppService {
  private readonly apiUrl = 'https://api.github.com';
  private readonly apiVersion = '2026-03-10';

  constructor(private readonly configService: ConfigService) {}

  createInstallUrl(organizationId: string, userId: string) {
    const appSlug = this.requireConfig('GITHUB_APP_SLUG');
    const state = this.signState({
      organizationId,
      userId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return {
      installUrl: `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`,
      expiresInSeconds: 600,
    };
  }

  verifyState(state: string, organizationId: string, userId: string) {
    const [encodedPayload, receivedSignature, extraPart] = state.split('.');

    if (!encodedPayload || !receivedSignature || extraPart) {
      throw new BadRequestException('Invalid GitHub setup state');
    }

    const expectedSignature = this.createStateSignature(encodedPayload);
    const receivedBuffer = Buffer.from(receivedSignature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new BadRequestException('Invalid GitHub setup state');
    }

    let payload: SetupState;

    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as SetupState;
    } catch {
      throw new BadRequestException('Invalid GitHub setup state');
    }

    if (
      payload.organizationId !== organizationId ||
      payload.userId !== userId ||
      payload.expiresAt <= Date.now()
    ) {
      throw new BadRequestException('Expired or mismatched GitHub setup state');
    }
  }

  async getInstallation(installationId: string) {
    return this.request<GithubInstallation>(
      `/app/installations/${installationId}`,
      this.createAppJwt(),
    );
  }

  async listInstallationRepositories(installationId: string) {
    const installationToken =
      await this.createInstallationToken(installationId);

    const response = await this.request<GithubRepositoryResponse>(
      '/installation/repositories?per_page=100',
      installationToken.token,
    );

    return response.repositories.map((repository) => ({
      externalId: String(repository.id),
      name: repository.name,
      fullName: repository.full_name,
      defaultBranch: repository.default_branch,
      private: repository.private,
      url: repository.html_url,
    }));
  }

  async getRepositoryMetadata(
    installationId: string,
    fullName: string,
    defaultBranch: string,
  ) {
    const installationToken =
      await this.createInstallationToken(installationId);
    const repositoryPath = fullName
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');

    const [branches, commits] = await Promise.all([
      this.request<GithubBranch[]>(
        `/repos/${repositoryPath}/branches?per_page=100`,
        installationToken.token,
      ),
      this.request<GithubCommit[]>(
        `/repos/${repositoryPath}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=100`,
        installationToken.token,
      ),
    ]);

    return {
      branches: branches.map((branch) => ({
        name: branch.name,
        sha: branch.commit.sha,
        isDefault: branch.name === defaultBranch,
      })),
      commits: commits.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        authorName: commit.commit.author?.name ?? null,
        authorEmail: commit.commit.author?.email ?? null,
        committedAt: commit.commit.author?.date
          ? new Date(commit.commit.author.date)
          : commit.commit.committer?.date
            ? new Date(commit.commit.committer.date)
            : null,
        url: commit.html_url,
      })),
    };
  }

  private createInstallationToken(installationId: string) {
    return this.request<GithubInstallationToken>(
      `/app/installations/${installationId}/access_tokens`,
      this.createAppJwt(),
      { method: 'POST' },
    );
  }

  private signState(payload: SetupState) {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    return `${encodedPayload}.${this.createStateSignature(encodedPayload)}`;
  }

  private createStateSignature(encodedPayload: string) {
    const secret =
      this.configService.get<string>('GITHUB_STATE_SECRET') ??
      this.requireConfig('JWT_SECRET');
    return createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64url');
  }

  private createAppJwt() {
    const appId = this.requireConfig('GITHUB_APP_ID');
    const privateKey = this.getPrivateKey();
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
    ).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(privateKey).toString('base64url');
    return `${signingInput}.${signature}`;
  }

  private getPrivateKey() {
    const privateKeyPath = this.configService.get<string>(
      'GITHUB_APP_PRIVATE_KEY_PATH',
    );

    if (privateKeyPath) {
      try {
        return readFileSync(privateKeyPath, 'utf8');
      } catch {
        throw new ServiceUnavailableException(
          'GITHUB_APP_PRIVATE_KEY_PATH cannot be read',
        );
      }
    }

    return this.requireConfig('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
  }

  private async request<T>(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': this.apiVersion,
          ...init.headers,
        },
      });
    } catch {
      throw new BadGatewayException('Unable to reach GitHub');
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `GitHub request failed with status ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }

  private requireConfig(name: string) {
    const value = this.configService.get<string>(name);

    if (!value) {
      throw new ServiceUnavailableException(`${name} is not configured`);
    }

    return value;
  }
}
