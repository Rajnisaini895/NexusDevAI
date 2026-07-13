import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GithubWebhookService } from './github-webhook.service';

interface AuthenticatedRequest {
  user: { userId: string };
}

@Controller()
export class GithubWebhookController {
  constructor(private readonly githubWebhookService: GithubWebhookService) {}

  @Post('github/webhooks')
  receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-github-event') event?: string,
    @Headers('x-github-delivery') deliveryId?: string,
  ) {
    this.githubWebhookService.verifySignature(request.rawBody, signature);
    return this.githubWebhookService.handleEvent(
      event,
      deliveryId,
      request.body,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(
    'workspaces/:workspaceId/repositories/:repositoryId/pull-request-reviews/latest',
  )
  findLatest(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
    @Param('repositoryId', new ParseUUIDPipe({ version: '4' }))
    repositoryId: string,
  ) {
    return this.githubWebhookService.findLatest(
      request.user.userId,
      workspaceId,
      repositoryId,
    );
  }
}
