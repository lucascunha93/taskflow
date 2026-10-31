
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { taskDateBound } from './task-date-range.js';

const taskDetailsSelect = {
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
  creator: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

type TaskDetails = Prisma.TaskGetPayload<{ select: typeof taskDetailsSelect }>;
type PaginatedTasks = {
  data: TaskDetails[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    userId: string,
    query: ListTasksQueryDto,
  ): Promise<PaginatedTasks> {
    await this.assertMembership(organizationId, userId);

    const skip = (query.page - 1) * query.limit;
    if (!Number.isSafeInteger(skip) || skip > 2147483647) {
      throw new BadRequestException('A página solicitada excede o limite de paginação.');
    }

    const where: Prisma.TaskWhereInput = {
      organizationId,
      organization: { memberships: { some: { userId } } },
      status: query.status,
      assigneeId: query.assigneeId,
      creatorId: query.creatorId,
      title: query.search === undefined
        ? undefined
        : { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' },
      dueDate: query.dueDateFrom === undefined && query.dueDateTo === undefined
        ? undefined
        : {
            gte: query.dueDateFrom === undefined ? undefined : taskDateBound(query.dueDateFrom, false),
            lte: query.dueDateTo === undefined ? undefined : taskDateBound(query.dueDateTo, true),
          },
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        select: taskDetailsSelect,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
        skip,
        take: query.limit,
      }),
      this.prisma.task.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });

    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(
    organizationId: string,
    taskId: string,
    userId: string,
  ): Promise<TaskDetails> {
    await this.assertMembership(organizationId, userId);

    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        organizationId,
        organization: { memberships: { some: { userId } } },
      },
      select: taskDetailsSelect,
    });

    if (!task) {
      throw new NotFoundException('Tarefa não encontrada.');
    }

    return task;
  }

  async create(
    organizationId: string,
    userId: string,
    dto: CreateTaskDto,
  ) {
    await this.assertMembership(organizationId, userId);

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

  async update(
    organizationId: string,
    taskId: string,
    userId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskDetails> {
    await this.assertMembership(organizationId, userId);

    if (dto.assigneeId != null && !(await this.isAssigneeMember(organizationId, dto.assigneeId))) {
      const current = await this.findOne(organizationId, taskId, userId);
      if (current.version !== dto.version) {
        throw new ConflictException('A tarefa foi alterada. Atualize os dados e tente novamente.');
      }
      throw new ForbiddenException('O responsável precisa pertencer à organização.');
    }

    const updated = await this.prisma.task.updateManyAndReturn({
      where: {
        id: taskId,
        organizationId,
        version: dto.version,
        organization: { memberships: { some: { userId } } },
        ...(dto.assigneeId != null
          ? {
              AND: [{
                organization: {
                  memberships: { some: { userId: dto.assigneeId } },
                },
              }],
            }
          : {}),
      },
      data: {
        title: dto.title?.trim(),
        description: typeof dto.description === 'string' ? dto.description.trim() : dto.description,
        status: dto.status,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate == null ? dto.dueDate : new Date(dto.dueDate),
        version: { increment: 1 },
      },
      select: taskDetailsSelect,
    });

    if (updated.length > 0) {
      return updated[0];
    }

    const current = await this.findOne(organizationId, taskId, userId);
    if (current.version !== dto.version) {
      throw new ConflictException('A tarefa foi alterada. Atualize os dados e tente novamente.');
    }

    if (dto.assigneeId != null && !(await this.isAssigneeMember(organizationId, dto.assigneeId))) {
      throw new ForbiddenException('O responsável precisa pertencer à organização.');
    }

    throw new ConflictException('A tarefa não pôde ser atualizada. Tente novamente.');
  }

  async remove(
    organizationId: string,
    taskId: string,
    userId: string,
    version: number,
  ): Promise<void> {
    await this.assertMembership(organizationId, userId);

    const result = await this.prisma.task.deleteMany({
      where: {
        id: taskId,
        organizationId,
        version,
        organization: { memberships: { some: { userId } } },
      },
    });

    if (result.count > 0) {
      return;
    }

    const current = await this.findOne(organizationId, taskId, userId);
    if (current.version !== version) {
      throw new ConflictException('A tarefa foi alterada. Atualize os dados e tente novamente.');
    }

    throw new ConflictException('A tarefa não pôde ser excluída. Tente novamente.');
  }

  private async isAssigneeMember(organizationId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });
    return membership !== null;
  }

  private async assertMembership(organizationId: string, userId: string): Promise<void> {
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
  }
}
