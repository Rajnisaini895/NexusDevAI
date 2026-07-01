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
import { CompleteGithubConnectionDto } from './dto/complete-github-connection.dto';
import { ProviderConnectionsService } from './provider-connections.service';

interface AuthenticatedRequest {
  user: { userId: string; email: string };
}

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/provider-connections')
export class ProviderConnectionsController {
  constructor(
    private readonly providerConnectionsService: ProviderConnectionsService,
  ) {}

  @Get()
  findAll(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
  ) {
    return this.providerConnectionsService.findAll(
      request.user.userId,
      organizationId,
    );
  }

  @Get('github/install-url')
  createGithubInstallUrl(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
  ) {
    return this.providerConnectionsService.createGithubInstallUrl(
      request.user.userId,
      organizationId,
    );
  }

  @Post('github/complete')
  completeGithubConnection(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Body() dto: CompleteGithubConnectionDto,
  ) {
    return this.providerConnectionsService.completeGithubConnection(
      request.user.userId,
      organizationId,
      dto,
    );
  }

  @Get(':connectionId/repositories')
  discoverRepositories(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Param('connectionId', new ParseUUIDPipe({ version: '4' }))
    connectionId: string,
  ) {
    return this.providerConnectionsService.discoverRepositories(
      request.user.userId,
      organizationId,
      connectionId,
    );
  }

  @Delete(':connectionId')
  disconnect(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Param('connectionId', new ParseUUIDPipe({ version: '4' }))
    connectionId: string,
  ) {
    return this.providerConnectionsService.disconnect(
      request.user.userId,
      organizationId,
      connectionId,
    );
  }
}
