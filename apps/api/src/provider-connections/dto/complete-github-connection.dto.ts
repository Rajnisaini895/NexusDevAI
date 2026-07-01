import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CompleteGithubConnectionDto {
  @IsString()
  @Matches(/^\d+$/, { message: 'installationId must be numeric' })
  installationId!: string;

  @IsString()
  @IsNotEmpty()
  state!: string;
}
