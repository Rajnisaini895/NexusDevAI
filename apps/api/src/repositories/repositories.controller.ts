import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { ImportRepositoryDto } from './dto/import-repository.dto';
import { ReviewRepositoryDto } from './dto/review-repository.dto';
import { SearchRepositoryDto } from './dto/search-repository.dto';
import { RepositoriesService } from './repositories.service';
import { RepositoryProcessingService } from './repository-processing.service';

interface AuthenticatedRequest {
  user: {
    userId: string;
    email: string;
  };
}

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/repositories')
export class RepositoriesController {
  constructor(
    private readonly repositoriesService: RepositoriesService,
    private readonly repositoryProcessingService: RepositoryProcessingService,
  ) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Body() createRepositoryDto: CreateRepositoryDto,
  ) {
    return this.repositoriesService.create(
      request.user.userId,
      workspaceId,
      createRepositoryDto,
    );
  }

  @Get()
  findAll(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
  ) {
    return this.repositoriesService.findAll(request.user.userId, workspaceId);
  }

  @Post('import')
  importRepository(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Body() importRepositoryDto: ImportRepositoryDto,
  ) {
    return this.repositoriesService.importFromGithub(
      request.user.userId,
      workspaceId,
      importRepositoryDto,
    );
  }

  @Get(':repositoryId')
  findOne(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoriesService.findOne(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }

  @Post(':repositoryId/sync')
  synchronize(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoriesService.synchronize(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }

  @Post(':repositoryId/ingest')
  ingestFiles(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoriesService.ingestFiles(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }

  @Post(':repositoryId/chunk')
  chunkFiles(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoriesService.chunkFiles(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }

  @Post(':repositoryId/embed')
  embedChunks(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoriesService.embedChunks(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }

  @Post(':repositoryId/search')
  searchChunks(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
    @Body() searchRepositoryDto: SearchRepositoryDto,
  ) {
    return this.repositoriesService.searchChunks(
      request.user.userId,
      workspaceId,
      repositoryId,
      searchRepositoryDto,
    );
  }

  @Post(':repositoryId/ask')
  answerQuestion(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
    @Body() searchRepositoryDto: SearchRepositoryDto,
  ) {
    return this.repositoriesService.answerQuestion(
      request.user.userId,
      workspaceId,
      repositoryId,
      searchRepositoryDto,
    );
  }

  @Get(':repositoryId/reviews')
  findReviews(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoriesService.findReviews(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }

  @Post(':repositoryId/review')
  reviewRepository(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
    @Body() reviewRepositoryDto: ReviewRepositoryDto,
  ) {
    return this.repositoriesService.reviewRepository(
      request.user.userId,
      workspaceId,
      repositoryId,
      reviewRepositoryDto,
    );
  }

  @Post(':repositoryId/process')
  processRepository(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoryProcessingService.enqueue(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }

  @Get(':repositoryId/process/latest')
  findLatestProcessingRun(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoryProcessingService.findLatest(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }

  @Delete(':repositoryId')
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.repositoriesService.remove(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }
}
