import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { GithubAppService } from './github-app.service';
import { ProviderConnectionsController } from './provider-connections.controller';
import { ProviderConnectionsService } from './provider-connections.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProviderConnectionsController],
  providers: [ProviderConnectionsService, GithubAppService],
  exports: [GithubAppService],
})
export class ProviderConnectionsModule {}
