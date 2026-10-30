
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
} from 'class-validator';

export enum TaskStatus {
    TODO = 'TODO',
    IN_PROGRESS = 'IN_PROGRESS',
    DONE = 'DONE',
    CANCELLED = 'CANCELLED',
}

export class UpdateTaskDto {
    @IsOptional()
    @IsString()
    @MinLength(3)
    @MaxLength(180)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(5000)
    description?: string;

    @IsOptional()
    @IsEnum(TaskStatus)
    status?: TaskStatus;

    @IsOptional()
    @IsUUID()
    assigneeId?: string;

    @IsOptional()
    @IsDateString()
    dueDate?: string;

    @IsInt()
    @Min(1)
    version!: number;
}
