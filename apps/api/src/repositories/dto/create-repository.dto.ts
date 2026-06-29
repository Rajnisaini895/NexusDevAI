import { GitProvider } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRepositoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  @Matches(/^[^\s/]+(?:\/[^\s/]+)+$/, {
    message: 'fullName must be a provider path such as owner/repository',
  })
  fullName!: string;

  @IsEnum(GitProvider)
  provider!: GitProvider;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  defaultBranch?: string;
}
