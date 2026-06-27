import { MemberRole } from '@prisma/client';
import { IsEmail, IsEnum } from 'class-validator';

export class AddOrganizationMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(MemberRole)
  role!: MemberRole;
}
