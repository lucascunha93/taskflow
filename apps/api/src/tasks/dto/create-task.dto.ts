import {
    IsDateString,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator.js';

export class CreateTaskDto {
    @Trim()
    @IsString()
    @MinLength(3)
    @MaxLength(180)
    title!: string;

    @Trim()
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    description?: string;

    @IsOptional()
    @IsUUID()
    assigneeId?: string;

    @IsOptional()
    @IsDateString()
    dueDate?: string;
}
