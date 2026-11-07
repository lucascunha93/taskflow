import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Trim } from '../../../common/validation/trim.decorator.js';

export const COMMENT_MAX_LENGTH = 5000;

export class CommentBodyDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(COMMENT_MAX_LENGTH)
  body!: string;
}

export class ListCommentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  /** Continua a listagem após este comentário (ordem cronológica). */
  @IsOptional()
  @IsUUID()
  after?: string;
}
