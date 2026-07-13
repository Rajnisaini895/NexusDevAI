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

interface GithubTreeResponse {
  truncated: boolean;
  tree: Array<{
    path: string;
    mode: string;
    type: 'blob' | 'tree' | 'commit';
    sha: string;
    size?: number;
  }>;
}

interface GithubBlob {
  content: string;
  encoding: string;
  size: number;
}

interface GithubPullRequestFile {
  sha: string;
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'changed' | 'copied';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface GithubPullRequestReview {
  id: number;
  html_url: string;
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
  private readonly maxFileSize = 100_000;
  private readonly maxFiles = 250;

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

  async getRepositoryFiles(
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
    const tree = await this.request<GithubTreeResponse>(
      `/repos/${repositoryPath}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
      installationToken.token,
    );

    if (tree.truncated) {
      throw new BadGatewayException(
        'GitHub repository tree is too large to ingest safely',
      );
    }

    const candidates = tree.tree
      .filter(
        (entry) =>
          entry.type === 'blob' &&
          typeof entry.size === 'number' &&
          entry.size <= this.maxFileSize &&
          this.isSupportedSourceFile(entry.path),
      )
      .slice(0, this.maxFiles);

    const files: Array<{
      path: string;
      sha: string;
      size: number;
      language: string | null;
      content: string;
    }> = [];

    for (let index = 0; index < candidates.length; index += 10) {
      const batch = candidates.slice(index, index + 10);
      const batchFiles = await Promise.all(
        batch.map(async (entry) => {
          const blob = await this.request<GithubBlob>(
            `/repos/${repositoryPath}/git/blobs/${entry.sha}`,
            installationToken.token,
          );

          if (blob.encoding !== 'base64') return null;
          const content = Buffer.from(
            blob.content.replace(/\s/g, ''),
            'base64',
          ).toString('utf8');
          if (content.includes('\u0000')) return null;

          return {
            path: entry.path,
            sha: entry.sha,
            size: blob.size,
            language: this.detectLanguage(entry.path),
            content,
          };
        }),
      );
      files.push(...batchFiles.filter((file) => file !== null));
    }

    return {
      files,
      skipped:
        tree.tree.filter((entry) => entry.type === 'blob').length -
        files.length,
      limited: candidates.length === this.maxFiles,
    };
  }

  async getPullRequestSources(
    installationId: string,
    fullName: string,
    pullRequestNumber: number,
  ) {
    const installationToken =
      await this.createInstallationToken(installationId);
    const repositoryPath = this.encodeRepositoryPath(fullName);
    const changedFiles = await this.request<GithubPullRequestFile[]>(
      `/repos/${repositoryPath}/pulls/${pullRequestNumber}/files?per_page=100`,
      installationToken.token,
    );
    const candidates = changedFiles
      .filter(
        (file) =>
          file.status !== 'removed' &&
          Boolean(file.patch) &&
          this.isSupportedSourceFile(file.filename),
      )
      .sort((left, right) => right.changes - left.changes)
      .slice(0, 12);
    const sources: Array<{
      path: string;
      startLine: number;
      endLine: number;
      content: string;
    }> = [];

    for (const file of candidates) {
      const blob = await this.request<GithubBlob>(
        `/repos/${repositoryPath}/git/blobs/${file.sha}`,
        installationToken.token,
      );
      if (blob.encoding !== 'base64' || blob.size > this.maxFileSize) continue;
      const content = Buffer.from(
        blob.content.replace(/\s/g, ''),
        'base64',
      ).toString('utf8');
      if (content.includes('\u0000')) continue;

      const lines = content.split(/\r?\n/);
      const changedLines = this.parseAddedLines(file.patch ?? '');
      if (changedLines.length === 0) continue;
      const firstChangedLine = changedLines[0];
      const lastChangedLine = changedLines.at(-1) ?? firstChangedLine;
      const startLine = Math.max(1, firstChangedLine - 20);
      const endLine = Math.min(
        lines.length,
        Math.min(lastChangedLine + 20, startLine + 119),
      );
      sources.push({
        path: file.filename,
        startLine,
        endLine,
        content: lines.slice(startLine - 1, endLine).join('\n'),
      });
    }

    return {
      sources: sources.slice(0, 8),
      changedFiles: changedFiles.length,
      eligibleFiles: candidates.length,
    };
  }

  async createPullRequestReview(
    installationId: string,
    fullName: string,
    pullRequestNumber: number,
    headSha: string,
    body: string,
  ) {
    const installationToken =
      await this.createInstallationToken(installationId);
    const repositoryPath = this.encodeRepositoryPath(fullName);
    const review = await this.request<GithubPullRequestReview>(
      `/repos/${repositoryPath}/pulls/${pullRequestNumber}/reviews`,
      installationToken.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit_id: headSha, body, event: 'COMMENT' }),
      },
    );
    return { id: String(review.id), url: review.html_url };
  }

  private isSupportedSourceFile(path: string) {
    const normalized = path.toLowerCase();
    const segments = normalized.split('/');
    const blockedDirectories = new Set([
      'node_modules',
      'dist',
      'build',
      '.next',
      'coverage',
      'vendor',
      '.git',
    ]);
    const filename = segments.at(-1) ?? '';

    if (segments.some((segment) => blockedDirectories.has(segment)))
      return false;
    if (
      filename === '.env' ||
      filename.startsWith('.env.') ||
      /\.(pem|key|p12|pfx|crt|cer|der|jks|keystore)$/i.test(filename)
    ) {
      return false;
    }

    const supportedNames = new Set([
      'dockerfile',
      'makefile',
      'readme',
      'readme.md',
      'package.json',
      'tsconfig.json',
      'docker-compose.yml',
      'docker-compose.yaml',
    ]);
    if (supportedNames.has(filename)) return true;

    return /\.(ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|rb|php|cs|cpp|cc|c|h|hpp|swift|kt|kts|scala|vue|svelte|html|css|scss|sass|less|sql|graphql|gql|sh|bash|zsh|md|mdx|json|ya?ml|toml|xml)$/i.test(
      filename,
    );
  }

  private detectLanguage(path: string) {
    const filename = path.toLowerCase().split('/').at(-1) ?? '';
    const extension = filename.includes('.') ? filename.split('.').at(-1) : '';
    const languages: Record<string, string> = {
      ts: 'TypeScript',
      tsx: 'TypeScript',
      js: 'JavaScript',
      jsx: 'JavaScript',
      mjs: 'JavaScript',
      cjs: 'JavaScript',
      py: 'Python',
      java: 'Java',
      go: 'Go',
      rs: 'Rust',
      rb: 'Ruby',
      php: 'PHP',
      cs: 'C#',
      cpp: 'C++',
      cc: 'C++',
      c: 'C',
      h: 'C',
      hpp: 'C++',
      swift: 'Swift',
      kt: 'Kotlin',
      kts: 'Kotlin',
      scala: 'Scala',
      vue: 'Vue',
      svelte: 'Svelte',
      html: 'HTML',
      css: 'CSS',
      scss: 'SCSS',
      sass: 'Sass',
      less: 'Less',
      sql: 'SQL',
      graphql: 'GraphQL',
      gql: 'GraphQL',
      sh: 'Shell',
      bash: 'Shell',
      zsh: 'Shell',
      md: 'Markdown',
      mdx: 'MDX',
      json: 'JSON',
      yaml: 'YAML',
      yml: 'YAML',
      toml: 'TOML',
      xml: 'XML',
    };
    return extension ? (languages[extension] ?? null) : null;
  }

  private parseAddedLines(patch: string) {
    const changedLines: number[] = [];
    let newLine = 0;

    for (const line of patch.split('\n')) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {
        newLine = Number(hunk[1]);
        continue;
      }
      if (newLine === 0 || line.startsWith('\\ No newline')) continue;
      if (line.startsWith('+') && !line.startsWith('+++')) {
        changedLines.push(newLine);
        newLine += 1;
      } else if (!line.startsWith('-')) {
        newLine += 1;
      }
    }

    return changedLines;
  }

  private encodeRepositoryPath(fullName: string) {
    return fullName
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
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
