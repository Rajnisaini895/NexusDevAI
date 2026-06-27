import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AddOrganizationMemberDto } from './dto/add-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';

@Injectable()
export class OrganizationMembersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, organizationId: string) {
    await this.findActorMembership(userId, organizationId);

    const members = await this.prisma.membership.findMany({
      where: { organizationId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return { members };
  }

  async add(
    userId: string,
    organizationId: string,
    addMemberDto: AddOrganizationMemberDto,
  ) {
    const actor = await this.findActorMembership(userId, organizationId);
    this.assertCanManageMembers(actor.role);

    if (
      addMemberDto.role === MemberRole.OWNER &&
      actor.role !== MemberRole.OWNER
    ) {
      throw new ForbiddenException('Only owners can add another owner');
    }

    const memberUser = await this.prisma.user.findUnique({
      where: { email: addMemberDto.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        deletedAt: true,
      },
    });

    if (
      !memberUser ||
      memberUser.status !== 'ACTIVE' ||
      memberUser.deletedAt !== null
    ) {
      throw new NotFoundException('Active user not found');
    }

    try {
      const membership = await this.prisma.membership.create({
        data: {
          userId: memberUser.id,
          organizationId,
          role: addMemberDto.role,
        },
        select: {
          id: true,
          role: true,
          createdAt: true,
        },
      });

      return {
        message: 'Organization member added successfully',
        member: {
          ...membership,
          user: {
            id: memberUser.id,
            email: memberUser.email,
            fullName: memberUser.fullName,
            status: memberUser.status,
          },
        },
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('User is already an organization member');
      }

      throw error;
    }
  }

  async updateRole(
    userId: string,
    organizationId: string,
    membershipId: string,
    updateMemberDto: UpdateOrganizationMemberDto,
  ) {
    const actor = await this.findActorMembership(userId, organizationId);
    this.assertCanManageMembers(actor.role);

    const target = await this.findTargetMembership(
      organizationId,
      membershipId,
    );

    if (
      actor.role !== MemberRole.OWNER &&
      (target.role === MemberRole.OWNER ||
        updateMemberDto.role === MemberRole.OWNER)
    ) {
      throw new ForbiddenException('Only owners can manage owner memberships');
    }

    if (
      target.role === MemberRole.OWNER &&
      updateMemberDto.role !== MemberRole.OWNER
    ) {
      await this.assertAnotherOwnerExists(organizationId, target.id);
    }

    const membership = await this.prisma.membership.update({
      where: { id: target.id },
      data: { role: updateMemberDto.role },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
          },
        },
      },
    });

    return {
      message: 'Organization member role updated successfully',
      member: membership,
    };
  }

  async remove(userId: string, organizationId: string, membershipId: string) {
    const actor = await this.findActorMembership(userId, organizationId);
    this.assertCanManageMembers(actor.role);

    const target = await this.findTargetMembership(
      organizationId,
      membershipId,
    );

    if (actor.role !== MemberRole.OWNER && target.role === MemberRole.OWNER) {
      throw new ForbiddenException('Only owners can remove another owner');
    }

    if (target.role === MemberRole.OWNER) {
      await this.assertAnotherOwnerExists(organizationId, target.id);
    }

    await this.prisma.membership.delete({ where: { id: target.id } });

    return { message: 'Organization member removed successfully' };
  }

  private async findActorMembership(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { id: true, role: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You do not have access to this organization',
      );
    }

    return membership;
  }

  private async findTargetMembership(
    organizationId: string,
    membershipId: string,
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
      },
      select: { id: true, userId: true, role: true },
    });

    if (!membership) {
      throw new NotFoundException('Organization member not found');
    }

    return membership;
  }

  private assertCanManageMembers(role: MemberRole) {
    if (role !== MemberRole.OWNER && role !== MemberRole.ADMIN) {
      throw new ForbiddenException(
        'Only organization owners and admins can manage members',
      );
    }
  }

  private async assertAnotherOwnerExists(
    organizationId: string,
    excludedMembershipId: string,
  ) {
    const otherOwnerCount = await this.prisma.membership.count({
      where: {
        organizationId,
        role: MemberRole.OWNER,
        id: { not: excludedMembershipId },
      },
    });

    if (otherOwnerCount === 0) {
      throw new BadRequestException(
        'An organization must always have at least one owner',
      );
    }
  }
}
