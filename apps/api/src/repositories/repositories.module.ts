import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ProviderConnectionsModule } from '../provider-connections/provider-connections.module';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';

@Module({
  imports: [PrismaModule, ProviderConnectionsModule],
  controllers: [RepositoriesController],
  providers: [RepositoriesService],
})
export class RepositoriesModule {}
