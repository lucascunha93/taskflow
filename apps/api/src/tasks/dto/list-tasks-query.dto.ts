import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator.js';
import { taskDateBound } from '../task-date-range.js';
import { TaskStatus } from './update-task.dto.js';

const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const sortFields = ['createdAt', 'updatedAt', 'dueDate', 'title'] as const;
const sortOrders = ['asc', 'desc'] as const;

@ValidatorConstraint({ name: 'taskDateRange', async: false })
class TaskDateRangeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const query = args.object;
    if (!(query instanceof ListTasksQueryDto) || typeof value !== 'string' || !query.dueDateFrom) {
      return true;
    }
    const from = taskDateBound(query.dueDateFrom, false).getTime();
    const to = taskDateBound(value, true).getTime();
    return Number.isNaN(from) || Number.isNaN(to) || from <= to;
  }

  defaultMessage(): string {
    return 'dueDateFrom não pode ser posterior a dueDateTo.';
  }
}

export class ListTasksQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(datePattern)
  dueDateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(datePattern)
  @Validate(TaskDateRangeConstraint)
  dueDateTo?: string;

  @IsIn(sortFields)
  sortBy: (typeof sortFields)[number] = 'updatedAt';

  @IsIn(sortOrders)
  sortOrder: (typeof sortOrders)[number] = 'desc';
}
