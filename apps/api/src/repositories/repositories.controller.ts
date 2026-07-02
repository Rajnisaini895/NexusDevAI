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
import { RepositoriesService } from './repositories.service';

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
  constructor(private readonly repositoriesService: RepositoriesService) {}

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
