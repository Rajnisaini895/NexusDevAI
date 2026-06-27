import { MemberRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateOrganizationMemberDto {
  @IsEnum(MemberRole)
  role!: MemberRole;
}
