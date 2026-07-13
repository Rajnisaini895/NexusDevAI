import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ProviderConnectionsModule } from '../provider-connections/provider-connections.module';
import { RepositoriesController } from './repositories.controller';
import { EmbeddingsService } from './embeddings.service';
import { OllamaGenerationService } from './ollama-generation.service';
import { RepositoriesService } from './repositories.service';
import { RepositoryProcessingService } from './repository-processing.service';

@Module({
  imports: [PrismaModule, ProviderConnectionsModule],
  controllers: [RepositoriesController],
  providers: [
    RepositoriesService,
    RepositoryProcessingService,
    EmbeddingsService,
    OllamaGenerationService,
  ],
  exports: [OllamaGenerationService],
})
export class RepositoriesModule {}
