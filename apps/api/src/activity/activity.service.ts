import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ActivityType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ActivityChange } from './task-changes.js';

export const activitySelect = {
  id: true,
  type: true,
  taskId: true,
  taskTitle: true,
  changes: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.TaskActivitySelect;

export interface ActivityInput {
  organizationId: string;
  taskId: string | null;
  taskTitle: string;
  actorId: string;
  type: ActivityType;
  changes?: ActivityChange[];
}

export interface ActivityPageQuery {
  limit?: number;
  before?: string;
}

type Client = PrismaService | Prisma.TransactionClient;

/** Grava e consulta o histórico de tarefas; leituras exigem associação à organização. */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Deve ser chamado dentro da mesma transação da operação registrada. */
  async record(client: Client, input: ActivityInput): Promise<void> {
    await client.taskActivity.create({
      data: {
        organizationId: input.organizationId,
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        actorId: input.actorId,
        type: input.type,
        ...(input.changes ? { changes: input.changes as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async listForOrganization(organizationId: string, userId: string, query: ActivityPageQuery) {
    await this.assertMembership(organizationId, userId);
    return this.page({ organizationId }, query.limit ?? 20, query.before);
  }

  async listForTask(organizationId: string, taskId: string, userId: string, query: ActivityPageQuery) {
    await this.assertMembership(organizationId, userId);
    const task = await this.prisma.task.findFirst({ where: { id: taskId, organizationId }, select: { id: true } });
    if (!task) {
      throw new NotFoundException('Tarefa não encontrada.');
    }
    return this.page({ organizationId, taskId }, query.limit ?? 50, query.before);
  }

  private async page(where: Prisma.TaskActivityWhereInput, limit: number, before?: string) {
    if (before) {
      const cursor = await this.prisma.taskActivity.findFirst({ where: { ...where, id: before }, select: { id: true } });
      if (!cursor) {
        throw new BadRequestException('O cursor informado não pertence a este histórico.');
      }
    }
    const rows = await this.prisma.taskActivity.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      select: activitySelect,
    });
    const data = rows.slice(0, limit);
    return { data, nextCursor: rows.length > limit ? data[data.length - 1].id : null };
  }

  private async assertMembership(organizationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });
    if (!membership) {
      throw new NotFoundException('Organização não encontrada.');
    }
  }
}
