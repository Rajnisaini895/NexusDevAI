import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddOrganizationMemberDto } from './dto/add-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';
import { OrganizationMembersService } from './organization-members.service';

interface AuthenticatedRequest {
  user: {
    userId: string;
    email: string;
  };
}

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/members')
export class OrganizationMembersController {
  constructor(
    private readonly organizationMembersService: OrganizationMembersService,
  ) {}

  @Get()
  findAll(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
  ) {
    return this.organizationMembersService.findAll(
      request.user.userId,
      organizationId,
    );
  }

  @Post()
  add(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Body() addMemberDto: AddOrganizationMemberDto,
  ) {
    return this.organizationMembersService.add(
      request.user.userId,
      organizationId,
      addMemberDto,
    );
  }

  @Patch(':membershipId')
  updateRole(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Param('membershipId', new ParseUUIDPipe({ version: '4' }))
    membershipId: string,
    @Body() updateMemberDto: UpdateOrganizationMemberDto,
  ) {
    return this.organizationMembersService.updateRole(
      request.user.userId,
      organizationId,
      membershipId,
      updateMemberDto,
    );
  }

  @Delete(':membershipId')
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Param('membershipId', new ParseUUIDPipe({ version: '4' }))
    membershipId: string,
  ) {
    return this.organizationMembersService.remove(
      request.user.userId,
      organizationId,
      membershipId,
    );
  }
}
