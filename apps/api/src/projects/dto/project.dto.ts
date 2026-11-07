import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator.js';

export class CreateProjectDto {
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateProjectDto {
  @Trim()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /** `null` ou texto vazio remove a descrição. */
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}
