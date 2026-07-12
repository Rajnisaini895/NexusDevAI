import {
  BadRequestException,
  BadGatewayException,
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
import { createHash } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { GithubAppService } from '../provider-connections/github-app.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { ImportRepositoryDto } from './dto/import-repository.dto';
import { ReviewRepositoryDto } from './dto/review-repository.dto';
import { SearchRepositoryDto } from './dto/search-repository.dto';
import { EmbeddingsService } from './embeddings.service';
import { OllamaGenerationService } from './ollama-generation.service';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubAppService: GithubAppService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly ollamaGenerationService: OllamaGenerationService,
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

  async ingestFiles(userId: string, workspaceId: string, repositoryId: string) {
    const membership = await this.findWorkspaceMembership(userId, workspaceId);

    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot ingest repository files');
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
      throw new NotFoundException('Ingestible GitHub repository not found');
    }

    const ingestion = await this.githubAppService.getRepositoryFiles(
      installationId,
      repository.fullName,
      repository.defaultBranch,
    );
    const synchronizedAt = new Date();
    const paths = ingestion.files.map((file) => file.path);

    await this.prisma.$transaction([
      this.prisma.repositoryFile.deleteMany({
        where: {
          repositoryId: repository.id,
          ...(paths.length > 0 ? { path: { notIn: paths } } : {}),
        },
      }),
      ...ingestion.files.map((file) =>
        this.prisma.repositoryFile.upsert({
          where: {
            repositoryId_path: {
              repositoryId: repository.id,
              path: file.path,
            },
          },
          create: {
            repositoryId: repository.id,
            ...file,
            lastSyncedAt: synchronizedAt,
          },
          update: {
            sha: file.sha,
            size: file.size,
            language: file.language,
            content: file.content,
            lastSyncedAt: synchronizedAt,
          },
        }),
      ),
    ]);

    return {
      message: 'Repository files ingested successfully',
      ingested: {
        files: ingestion.files.length,
        skipped: ingestion.skipped,
        limited: ingestion.limited,
      },
    };
  }

  async chunkFiles(userId: string, workspaceId: string, repositoryId: string) {
    const membership = await this.findWorkspaceMembership(userId, workspaceId);

    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot build repository chunks');
    }

    const repository = await this.prisma.repository.findFirst({
      where: { id: repositoryId, workspaceId },
      select: { id: true },
    });

    if (!repository) throw new NotFoundException('Repository not found');

    const files = await this.prisma.repositoryFile.findMany({
      where: { repositoryId },
      select: {
        id: true,
        repositoryId: true,
        sha: true,
        language: true,
        content: true,
        chunks: {
          select: { sourceSha: true },
          orderBy: { chunkIndex: 'asc' },
          take: 1,
        },
      },
      orderBy: { path: 'asc' },
    });

    let filesProcessed = 0;
    let filesUnchanged = 0;
    let chunksCreated = 0;

    for (const file of files) {
      if (file.chunks[0]?.sourceSha === file.sha) {
        filesUnchanged += 1;
        continue;
      }

      const chunks = this.createChunks(file.content).map((chunk) => ({
        repositoryId: file.repositoryId,
        fileId: file.id,
        language: file.language,
        sourceSha: file.sha,
        ...chunk,
      }));

      await this.prisma.$transaction([
        this.prisma.repositoryChunk.deleteMany({ where: { fileId: file.id } }),
        this.prisma.repositoryChunk.createMany({ data: chunks }),
      ]);
      filesProcessed += 1;
      chunksCreated += chunks.length;
    }

    return {
      message: 'Repository chunks built successfully',
      chunked: {
        filesProcessed,
        filesUnchanged,
        chunksCreated,
      },
    };
  }

  async embedChunks(userId: string, workspaceId: string, repositoryId: string) {
    const membership = await this.findWorkspaceMembership(userId, workspaceId);

    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot embed repository chunks');
    }

    const repository = await this.prisma.repository.findFirst({
      where: { id: repositoryId, workspaceId },
      select: { id: true },
    });
    if (!repository) throw new NotFoundException('Repository not found');

    const chunks = await this.prisma.repositoryChunk.findMany({
      where: {
        repositoryId,
        OR: [
          { embedding: { isEmpty: true } },
          { embeddingModel: { not: this.embeddingsService.model } },
        ],
      },
      select: { id: true, content: true },
      orderBy: [{ fileId: 'asc' }, { chunkIndex: 'asc' }],
    });

    const batchSize = 10;
    let embedded = 0;
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      const vectors = await this.embeddingsService.create(
        batch.map((chunk) => chunk.content),
      );
      const embeddedAt = new Date();

      await this.prisma.$transaction(
        batch.map((chunk, index) =>
          this.prisma.repositoryChunk.update({
            where: { id: chunk.id },
            data: {
              embedding: vectors[index],
              embeddingModel: this.embeddingsService.model,
              embeddedAt,
            },
          }),
        ),
      );
      embedded += batch.length;
    }

    return {
      message: 'Repository chunks embedded successfully',
      embedded: {
        created: embedded,
        unchanged: (await this.countEmbedded(repositoryId)) - embedded,
      },
    };
  }

  async searchChunks(
    userId: string,
    workspaceId: string,
    repositoryId: string,
    searchRepositoryDto: SearchRepositoryDto,
  ) {
    await this.findWorkspaceMembership(userId, workspaceId);

    const repository = await this.prisma.repository.findFirst({
      where: { id: repositoryId, workspaceId },
      select: { id: true },
    });
    if (!repository) throw new NotFoundException('Repository not found');

    const [queryEmbedding] = await this.embeddingsService.create([
      searchRepositoryDto.query.trim(),
    ]);
    const chunks = await this.prisma.repositoryChunk.findMany({
      where: {
        repositoryId,
        embeddingModel: this.embeddingsService.model,
        embedding: { isEmpty: false },
      },
      select: {
        id: true,
        chunkIndex: true,
        startLine: true,
        endLine: true,
        language: true,
        content: true,
        embedding: true,
        file: { select: { path: true } },
      },
    });

    const results = chunks
      .map(({ embedding, file, ...chunk }) => ({
        ...chunk,
        path: file.path,
        score: this.cosineSimilarity(queryEmbedding, embedding),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, searchRepositoryDto.limit);

    return { query: searchRepositoryDto.query.trim(), results };
  }

  async answerQuestion(
    userId: string,
    workspaceId: string,
    repositoryId: string,
    searchRepositoryDto: SearchRepositoryDto,
  ) {
    const search = await this.searchChunks(userId, workspaceId, repositoryId, {
      query: searchRepositoryDto.query,
      limit: 6,
    });

    if (search.results.length === 0) {
      throw new BadGatewayException(
        'No embedded repository chunks are available for this question',
      );
    }

    const generated = await this.ollamaGenerationService.answer(
      search.query,
      search.results,
    );

    return {
      question: search.query,
      ...generated,
      sources: search.results.map(
        ({ id, path, startLine, endLine, language, score }) => ({
          id,
          path,
          startLine,
          endLine,
          language,
          score,
        }),
      ),
    };
  }

  async findReviews(userId: string, workspaceId: string, repositoryId: string) {
    await this.findWorkspaceMembership(userId, workspaceId);
    await this.requireRepository(workspaceId, repositoryId);

    const [reviews, latestRun] = await Promise.all([
      this.prisma.repositoryCodeReview.findMany({
        where: { repositoryId },
        orderBy: [{ createdAt: 'desc' }, { severity: 'desc' }],
      }),
      this.prisma.repositoryCodeReviewRun.findFirst({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { reviews, latestRun };
  }

  async reviewRepository(
    userId: string,
    workspaceId: string,
    repositoryId: string,
    reviewRepositoryDto: ReviewRepositoryDto,
  ) {
    const membership = await this.findWorkspaceMembership(userId, workspaceId);
    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Viewers cannot run repository reviews');
    }
    await this.requireRepository(workspaceId, repositoryId);

    const candidateChunks = await this.prisma.repositoryChunk.findMany({
      where: {
        repositoryId,
        embedding: { isEmpty: false },
      },
      select: {
        startLine: true,
        endLine: true,
        content: true,
        file: { select: { path: true } },
      },
      take: Math.max(reviewRepositoryDto.limit * 8, 24),
    });
    const sources = candidateChunks
      .sort((left, right) => {
        const difference =
          this.reviewPriority(right.file.path, right.content) -
          this.reviewPriority(left.file.path, left.content);
        return difference || left.file.path.localeCompare(right.file.path);
      })
      .slice(0, reviewRepositoryDto.limit)
      .map(({ file, ...chunk }) => ({ path: file.path, ...chunk }));

    if (sources.length === 0) {
      throw new BadRequestException(
        'Create repository chunks and embeddings before running a review',
      );
    }

    const generated = await this.ollamaGenerationService.reviewCode(sources);
    await this.prisma.$transaction([
      this.prisma.repositoryCodeReview.deleteMany({
        where: { repositoryId },
      }),
      ...(generated.reviews.length
        ? [
            this.prisma.repositoryCodeReview.createMany({
              data: generated.reviews.map((review) => ({
                repositoryId,
                ...review,
                severity: review.severity,
              })),
            }),
          ]
        : []),
      this.prisma.repositoryCodeReviewRun.create({
        data: {
          repositoryId,
          model: generated.model,
          chunksReviewed: sources.length,
          issuesFound: generated.reviews.length,
        },
      }),
    ]);
    const reviews = await this.prisma.repositoryCodeReview.findMany({
      where: { repositoryId },
      orderBy: [{ createdAt: 'desc' }, { severity: 'desc' }],
    });

    return {
      message: 'Repository review completed',
      model: generated.model,
      reviewed: { chunks: sources.length, issues: reviews.length },
      reviews,
    };
  }

  private countEmbedded(repositoryId: string) {
    return this.prisma.repositoryChunk.count({
      where: {
        repositoryId,
        embeddingModel: this.embeddingsService.model,
        embedding: { isEmpty: false },
      },
    });
  }

  private requireRepository(workspaceId: string, repositoryId: string) {
    return this.prisma.repository
      .findFirst({
        where: { id: repositoryId, workspaceId },
        select: { id: true },
      })
      .then((repository) => {
        if (!repository) throw new NotFoundException('Repository not found');
        return repository;
      });
  }

  private reviewPriority(path: string, content: string) {
    const normalizedPath = path.toLowerCase();
    let score = 0;
    if (/\.(ts|tsx|js|jsx|py|go|rs|java|cs|rb|php)$/.test(normalizedPath)) {
      score += 3;
    }
    if (
      /(auth|security|session|token|permission|controller|service)/.test(
        normalizedPath,
      )
    ) {
      score += 5;
    }
    if (/(test|spec|fixture|mock|generated|migration)/.test(normalizedPath)) {
      score -= 5;
    }
    if (
      /(password|token|authorization|transaction|delete|update|fetch|crypto|catch|throw)/i.test(
        content,
      )
    ) {
      score += 3;
    }
    return score;
  }

  private cosineSimilarity(left: number[], right: number[]) {
    if (left.length !== right.length || left.length === 0) return 0;

    let dotProduct = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
      dotProduct += left[index] * right[index];
      leftMagnitude += left[index] ** 2;
      rightMagnitude += right[index] ** 2;
    }

    const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  private createChunks(content: string) {
    const lines = content.split(/\r?\n/);
    const chunkSize = 80;
    const overlap = 15;
    const chunks: Array<{
      chunkIndex: number;
      startLine: number;
      endLine: number;
      contentHash: string;
      content: string;
    }> = [];

    for (let start = 0; start < lines.length; start += chunkSize - overlap) {
      const end = Math.min(start + chunkSize, lines.length);
      const chunkContent = lines.slice(start, end).join('\n');
      if (chunkContent.trim()) {
        chunks.push({
          chunkIndex: chunks.length,
          startLine: start + 1,
          endLine: end,
          contentHash: createHash('sha256').update(chunkContent).digest('hex'),
          content: chunkContent,
        });
      }
      if (end === lines.length) break;
    }

    return chunks;
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
    processingRuns: {
      select: {
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
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    },
    _count: {
      select: { branches: true, commits: true, files: true, chunks: true },
    },
    createdAt: true,
    updatedAt: true,
  } as const;
}
