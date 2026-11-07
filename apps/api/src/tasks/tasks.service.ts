
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { taskDateBound } from './task-date-range.js';
import { ActivityService } from '../activity/activity.service.js';
import { taskChanges } from '../activity/task-changes.js';
import { NotificationsService } from '../notifications/notifications.service.js';

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
  projectId: true,
  organizationId: true,
  creator: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

const summaryTaskSelect = {
  id: true,
  organizationId: true,
  title: true,
  status: true,
  dueDate: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

type TaskDetails = Prisma.TaskGetPayload<{ select: typeof taskDetailsSelect }>;
type PaginatedTasks = {
  data: TaskDetails[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  async summary(organizationId: string, userId: string) {
    await this.assertMembership(organizationId, userId);
    const asOf = new Date();
    const dueUntil = new Date(asOf.getTime() + 7 * 24 * 60 * 60 * 1000);
    const where: Prisma.TaskWhereInput = {
      organizationId,
      organization: { memberships: { some: { userId } } },
    };
    const [groups, myTasks, dueSoon, recentlyUpdated] = await this.prisma.$transaction([
      this.prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.task.findMany({
        where: { ...where, assigneeId: userId },
        select: summaryTaskSelect,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: 5,
      }),
      this.prisma.task.findMany({
        where: { ...where, status: { in: ['TODO', 'IN_PROGRESS'] }, dueDate: { gte: asOf, lte: dueUntil } },
        select: summaryTaskSelect,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: 5,
      }),
      this.prisma.task.findMany({
        where,
        select: summaryTaskSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    ], { isolationLevel: 'RepeatableRead' });

    const counts = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 };
    for (const group of groups) counts[group.status] = group._count._all;
    return {
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      counts,
      asOf,
      dueUntil,
      myTasks,
      dueSoon,
      recentlyUpdated,
    };
  }

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
      projectId: query.projectId,
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

    if (dto.projectId) await this.assertProjectInOrganization(organizationId, dto.projectId);

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: dto.title.trim(),
          ...(dto.status === undefined ? {} : { status: dto.status }),
          description: dto.description?.trim() || null,
          organizationId,
          creatorId: userId,
          assigneeId: dto.assigneeId ?? null,
          projectId: dto.projectId ?? null,
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
          projectId: true,
          organizationId: true,
        },
      });

      await this.activity.record(tx, {
        organizationId, taskId: task.id, taskTitle: task.title, actorId: userId, type: 'TASK_CREATED',
      });
      await this.notifications.notify(tx, {
        organizationId, taskId: task.id, taskTitle: task.title, actorId: userId, type: 'TASK_ASSIGNED',
        recipients: [task.assigneeId],
      });
      return task;
    }).catch((error: unknown) => this.projectRace(error));
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

    if (dto.projectId != null) await this.assertProjectInOrganization(organizationId, dto.projectId);

    const saved = await this.prisma.$transaction(async (tx) => {
      // Estado anterior para o histórico. Como toda escrita incrementa a versão,
      // uma atualização bem-sucedida partiu exatamente deste estado.
      const before = await tx.task.findFirst({
        where: { id: taskId, organizationId, version: dto.version, organization: { memberships: { some: { userId } } } },
        select: taskDetailsSelect,
      });
      const updated = await tx.task.updateManyAndReturn({
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
          projectId: dto.projectId,
          dueDate: dto.dueDate == null ? dto.dueDate : new Date(dto.dueDate),
          version: { increment: 1 },
        },
        select: taskDetailsSelect,
      });

      if (updated.length === 0) return null;
      const after = updated[0];
      const changes = before ? taskChanges(before, after) : [];
      if (changes.length > 0) {
        await this.activity.record(tx, {
          organizationId, taskId, taskTitle: after.title, actorId: userId, type: 'TASK_UPDATED', changes,
        });
      }
      if (before && after.assigneeId && after.assigneeId !== before.assigneeId) {
        await this.notifications.notify(tx, {
          organizationId, taskId, taskTitle: after.title, actorId: userId, type: 'TASK_ASSIGNED',
          recipients: [after.assigneeId],
        });
      }
      return after;
    }).catch((error: unknown) => this.projectRace(error));

    if (saved) {
      return saved;
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

    const removed = await this.prisma.$transaction(async (tx) => {
      const before = await tx.task.findFirst({
        where: { id: taskId, organizationId, version, organization: { memberships: { some: { userId } } } },
        select: { title: true },
      });
      const result = await tx.task.deleteMany({
        where: {
          id: taskId,
          organizationId,
          version,
          organization: { memberships: { some: { userId } } },
        },
      });
      if (result.count === 0) return false;
      // A tarefa não existe mais: a atividade guarda apenas o título.
      await this.activity.record(tx, {
        organizationId, taskId: null, taskTitle: before?.title ?? 'Tarefa excluída', actorId: userId, type: 'TASK_DELETED',
      });
      return true;
    });

    if (removed) {
      return;
    }

    const current = await this.findOne(organizationId, taskId, userId);
    if (current.version !== version) {
      throw new ConflictException('A tarefa foi alterada. Atualize os dados e tente novamente.');
    }

    throw new ConflictException('A tarefa não pôde ser excluída. Tente novamente.');
  }

  /** Projeto excluído entre a validação e a escrita: a chave estrangeira recusa a operação. */
  private projectRace(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new BadRequestException('O projeto informado não pertence à organização.');
    }
    throw error;
  }

  /** O projeto precisa existir na mesma organização da tarefa. */
  private async assertProjectInOrganization(organizationId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) {
      throw new BadRequestException('O projeto informado não pertence à organização.');
    }
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
