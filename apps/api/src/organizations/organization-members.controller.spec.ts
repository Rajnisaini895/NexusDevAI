import { MemberRole } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { OrganizationMembersController } from './organization-members.controller';
import { OrganizationMembersService } from './organization-members.service';

describe('OrganizationMembersController', () => {
  let controller: OrganizationMembersController;

  const organizationMembersService = {
    add: jest.fn(),
    findAll: jest.fn(),
    remove: jest.fn(),
    updateRole: jest.fn(),
  };

  const request = {
    user: { userId: 'user-id', email: 'owner@nexusdev.ai' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationMembersController],
      providers: [
        {
          provide: OrganizationMembersService,
          useValue: organizationMembersService,
        },
      ],
    }).compile();

    controller = module.get<OrganizationMembersController>(
      OrganizationMembersController,
    );
  });

  it('uses the authenticated user when adding a member', async () => {
    const dto = {
      email: 'developer@nexusdev.ai',
      role: MemberRole.DEVELOPER,
    };
    organizationMembersService.add.mockResolvedValue({
      message: 'Organization member added successfully',
    });

    await controller.add(request, 'organization-id', dto);

    expect(organizationMembersService.add).toHaveBeenCalledWith(
      'user-id',
      'organization-id',
      dto,
    );
  });

  it('scopes removal to the authenticated user and organization', async () => {
    organizationMembersService.remove.mockResolvedValue({
      message: 'Organization member removed successfully',
    });

    await controller.remove(request, 'organization-id', 'membership-id');

    expect(organizationMembersService.remove).toHaveBeenCalledWith(
      'user-id',
      'organization-id',
      'membership-id',
    );
  });
});
