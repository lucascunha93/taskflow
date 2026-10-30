
import {
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator.js';

export enum TaskStatus {
    TODO = 'TODO',
    IN_PROGRESS = 'IN_PROGRESS',
    DONE = 'DONE',
    CANCELLED = 'CANCELLED',
}

export class UpdateTaskDto {
    @Trim()
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(3)
    @MaxLength(180)
    title?: string;

    @Trim()
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(5000)
    description?: string | null;

    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsEnum(TaskStatus)
    status?: TaskStatus;

    @IsOptional()
    @IsUUID()
    assigneeId?: string | null;

    @IsOptional()
    @IsDateString({ strict: true })
    dueDate?: string | null;

    @IsInt()
    @Min(1)
    version!: number;
}
