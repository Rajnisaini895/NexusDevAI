import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationsService } from './organizations.service';

interface AuthenticatedRequest {
  user: {
    userId: string;
    email: string;
  };
}

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() createOrganizationDto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(
      request.user.userId,
      createOrganizationDto,
    );
  }

  @Get()
  findAll(@Req() request: AuthenticatedRequest) {
    return this.organizationsService.findAllForUser(request.user.userId);
  }
}
