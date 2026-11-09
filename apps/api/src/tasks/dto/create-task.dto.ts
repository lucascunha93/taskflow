import {
    IsDateString,
    IsEnum,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator.js';
import { TaskStatus } from './update-task.dto.js';

export class CreateTaskDto {
    /**
     * Identificador gerado pelo cliente (UUID). Torna a criação idempotente:
     * reenviar a mesma tarefa, como faz o app mobile ao sincronizar, devolve a
     * tarefa já criada em vez de duplicá-la.
     */
    @IsOptional()
    @IsUUID()
    id?: string;

    @Trim()
    @IsString()
    @MinLength(3)
    @MaxLength(180)
    title!: string;

    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsEnum(TaskStatus)
    status?: TaskStatus;

    @Trim()
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    description?: string;

    @IsOptional()
    @IsUUID()
    assigneeId?: string;

    @IsOptional()
    @IsUUID()
    projectId?: string;

    @IsOptional()
    @IsDateString()
    dueDate?: string;
}
