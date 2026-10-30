import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class DeleteTaskDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  version!: number;
}
