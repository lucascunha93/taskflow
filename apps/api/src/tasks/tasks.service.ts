
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    organizationId: string,
    userId: string,
    dto: CreateTaskDto,
  ) {
    // 1. Verifica se o usuário pertence à organização.
    const membership = await this.prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Organização não encontrada.');
    }

    // 2. Se houver responsável, verifica se ele pertence
    // à mesma organização.
    if (dto.assigneeId) {
      const assigneeMembership =
        await this.prisma.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId,
              userId: dto.assigneeId,
            },
          },
        });

      if (!assigneeMembership) {
        throw new ForbiddenException(
          'O responsável precisa pertencer à organização.',
        );
      }
    }

    // 3. Cria a tarefa.
    const task = await this.prisma.task.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        organizationId,
        creatorId: userId,
        assigneeId: dto.assigneeId ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        version: true,
        dueDate: true,
        createdAt: true,
        updatedAt: true,
        creatorId: true,
        assigneeId: true,
        organizationId: true,
      },
    });

    return task;
  }
}
