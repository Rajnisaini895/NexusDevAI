import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ImportRepositoryDto {
  @IsUUID('4')
  connectionId!: string;

  @IsString()
  @IsNotEmpty()
  externalRepositoryId!: string;
}
