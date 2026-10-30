
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { CreateTaskDto } from './dto/create-task.dto.js';

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

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string, userId: string): Promise<TaskDetails[]> {
    await this.assertMembership(organizationId, userId);

    return this.prisma.task.findMany({
      where: {
        organizationId,
        organization: { memberships: { some: { userId } } },
      },
      select: taskDetailsSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
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
