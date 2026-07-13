import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ProviderConnectionsModule } from '../provider-connections/provider-connections.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubWebhookService } from './github-webhook.service';

@Module({
  imports: [PrismaModule, ProviderConnectionsModule, RepositoriesModule],
  controllers: [GithubWebhookController],
  providers: [GithubWebhookService],
})
export class GithubWebhooksModule {}
