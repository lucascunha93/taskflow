import {
    IsDateString,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
} from 'class-validator';

export class CreateTaskDto {
    @IsString()
    @MinLength(3)
    @MaxLength(180)
    title!: string;

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
