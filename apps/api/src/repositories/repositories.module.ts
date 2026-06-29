import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';

@Module({
  imports: [PrismaModule],
  controllers: [RepositoriesController],
  providers: [RepositoriesService],
})
export class RepositoriesModule {}
