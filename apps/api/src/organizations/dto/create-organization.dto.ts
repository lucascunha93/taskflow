import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator.js';

export class CreateOrganizationDto {
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}