import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlanLimitException } from '../plans/plan-limits.js';
import { PlansService } from '../plans/plans.service.js';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto.js';
import { TaskStatus } from './dto/update-task.dto.js';
import { TasksService } from './tasks.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('TasksService', () => {
  const storage = { deleteQuietly: vi.fn().mockResolvedValue(undefined), isConfigured: () => false };
  let service: TasksService;
  let moduleRef: TestingModule;
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    membership: { findUnique: ReturnType<typeof vi.fn> };
    project: { findFirst: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
    taskAttachment: { findMany: ReturnType<typeof vi.fn> };
    task: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      updateManyAndReturn: ReturnType<typeof vi.fn>;
    };
  };
  const organizationId = 'organization-a';
  const userId = 'creator';

  let activity: { record: ReturnType<typeof vi.fn> };
  let notifications: { notify: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    activity = { record: vi.fn().mockResolvedValue(undefined) };
    notifications = { notify: vi.fn().mockResolvedValue(undefined) };
    prisma = {
      // Aceita os dois estilos de transação: lista de operações e callback interativo.
      $transaction: vi.fn((operations: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof operations === 'function' ? operations(prisma) : Promise.all(operations)),
      membership: { findUnique: vi.fn() },
      project: { findFirst: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
      taskAttachment: { findMany: vi.fn().mockResolvedValue([]) },
      task: {
        create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(),
        deleteMany: vi.fn(), updateManyAndReturn: vi.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PlansService, useValue: { assertCanCreate: vi.fn(), assertCanStore: vi.fn(), assertCanOwnFreeOrganization: vi.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: ActivityService, useValue: activity },
        { provide: ObjectStorageService, useValue: storage },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(TasksService);
    moduleRef = module;
  });

  it('does not create tasks for a requester outside the organization', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.create(organizationId, userId, { title: 'Task' }))
      .rejects.toMatchObject({ status: 404 });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rejects assignees outside the same organization', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ id: 'creator-membership' }).mockResolvedValueOnce(null);
    await expect(service.create(organizationId, userId, { title: 'Task', assigneeId: 'outsider' }))
      .rejects.toMatchObject({ status: 403 });
    expect(prisma.membership.findUnique).toHaveBeenLastCalledWith({
      where: { organizationId_userId: { organizationId, userId: 'outsider' } },
    });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('creates a task with the authenticated creator and authorized assignee', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.create.mockResolvedValue({ id: 'task' });
    await expect(service.create(organizationId, userId, {
      title: ' Task ', description: ' Details ', assigneeId: 'member', dueDate: '2026-10-30',
    })).resolves.toEqual({ id: 'task' });
    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        title: 'Task', description: 'Details', organizationId, creatorId: userId,
        assigneeId: 'member', projectId: null, dueDate: new Date('2026-10-30'),
      },
    }));
  });

  it('checks the task limit of the plan before creating', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    const plans = moduleRef.get(PlansService) as unknown as { assertCanCreate: ReturnType<typeof vi.fn> };
    plans.assertCanCreate.mockRejectedValueOnce(new PlanLimitException('tasks', 'FREE', 'limite'));
    await expect(service.create(organizationId, userId, { title: 'Nova tarefa' })).rejects.toMatchObject({
      status: 403, response: { code: 'PLAN_LIMIT_REACHED', limit: 'tasks' },
    });
    expect(plans.assertCanCreate).toHaveBeenCalledWith(expect.anything(), organizationId, 'tasks');
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('creates a task with the requested valid status', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.create.mockResolvedValue({ id: 'task' });
    await service.create(organizationId, userId, { title: 'Task', status: TaskStatus.DONE });
    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: TaskStatus.DONE }),
    }));
  });

  it('rejects task reads by users outside the organization without querying tasks', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.findAll(organizationId, userId, new ListTasksQueryDto())).rejects.toMatchObject({ status: 404 });
    await expect(service.findOne(organizationId, 'task-b', userId)).rejects.toMatchObject({ status: 404 });
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(prisma.task.count).not.toHaveBeenCalled();
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
  });

  it('lists only authorized organization tasks in deterministic update order with safe fields', async () => {
    const tasks = [{ id: 'task-a', creator: { id: userId, name: 'Creator' }, assignee: null }];
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findMany.mockResolvedValue(tasks);
    prisma.task.count.mockResolvedValue(1);

    await expect(service.findAll(organizationId, userId, new ListTasksQueryDto())).resolves.toEqual({
      data: tasks, meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId, userId } },
    });
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: {
        organizationId, organization: { memberships: { some: { userId } } },
        status: undefined, assigneeId: undefined, creatorId: undefined, projectId: undefined, title: undefined, dueDate: undefined,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
      select: {
        id: true, title: true, description: true, status: true, version: true,
        dueDate: true, createdAt: true, updatedAt: true, creatorId: true,
        assigneeId: true, projectId: true, organizationId: true,
        creator: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });
    expect(prisma.task.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId, organization: { memberships: { some: { userId } } },
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: 'RepeatableRead' });
  });

  it('returns an empty list for an authorized organization without tasks', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.count.mockResolvedValue(0);
    await expect(service.findAll(organizationId, userId, new ListTasksQueryDto())).resolves.toEqual({
      data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('applies combined filters identically to data and count with database pagination', async () => {
    const query = Object.assign(new ListTasksQueryDto(), {
      page: 3, limit: 5, status: TaskStatus.DONE, assigneeId: 'assignee', creatorId: 'creator',
      search: '50%_\\done', dueDateFrom: '2026-10-01', dueDateTo: '2026-10-31',
      sortBy: 'title', sortOrder: 'asc',
    });
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.count.mockResolvedValue(11);
    await expect(service.findAll(organizationId, userId, query)).resolves.toEqual({
      data: [], meta: { page: 3, limit: 5, total: 11, totalPages: 3 },
    });
    const where = {
      organizationId,
      organization: { memberships: { some: { userId } } },
      status: TaskStatus.DONE, assigneeId: 'assignee', creatorId: 'creator',
      title: { contains: '50\\%\\_\\\\done', mode: 'insensitive' },
      dueDate: { gte: new Date('2026-10-01T00:00:00.000Z'), lte: new Date('2026-10-31T23:59:59.999Z') },
    };
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where, skip: 10, take: 5, orderBy: [{ title: 'asc' }, { id: 'asc' }],
    }));
    expect(prisma.task.count).toHaveBeenCalledWith({ where });
  });

  it('rejects offsets beyond the supported range without querying tasks', async () => {
    const query = Object.assign(new ListTasksQueryDto(), { page: 2147483647, limit: 100 });
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    await expect(service.findAll(organizationId, userId, query)).rejects.toMatchObject({ status: 400 });
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(prisma.task.count).not.toHaveBeenCalled();
  });

  it('scopes detail lookup to the task, organization and authenticated member', async () => {
    const task = { id: 'task-a', organizationId, creator: { id: userId, name: 'Creator' }, assignee: null };
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findFirst.mockResolvedValue(task);
    await expect(service.findOne(organizationId, task.id, userId)).resolves.toEqual(task);
    expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: task.id, organizationId,
        organization: { memberships: { some: { userId } } },
      },
      select: expect.objectContaining({
        creator: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      }),
    }));
  });

  it('returns 404 for a missing task or one outside the requested organization', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findFirst.mockResolvedValue(null);
    await expect(service.findOne(organizationId, 'task-b', userId))
      .rejects.toMatchObject({ status: 404, message: 'Tarefa não encontrada.' });
    expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'task-b', organizationId,
        organization: { memberships: { some: { userId } } },
      },
    }));
  });

  it('updates supplied fields atomically, increments the version and records the changes', async () => {
    const before = {
      id: 'task-a', organizationId, version: 2, title: 'Old', description: null, status: TaskStatus.TODO,
      dueDate: null, assignee: null,
    };
    const updated = {
      ...before, version: 3, title: 'Updated', description: 'Details', status: TaskStatus.DONE,
      dueDate: new Date('2026-10-30'), assignee: { id: 'member', name: 'Member' },
    };
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findFirst.mockResolvedValue(before);
    prisma.task.updateManyAndReturn.mockResolvedValue([updated]);

    await expect(service.update(organizationId, 'task-a', userId, {
      version: 2, title: ' Updated ', description: ' Details ', status: TaskStatus.DONE,
      assigneeId: 'member', dueDate: '2026-10-30',
    })).resolves.toEqual(updated);
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId, userId: 'member' } },
      select: { id: true },
    });
    expect(prisma.task.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'task-a', organizationId, version: 2,
        organization: { memberships: { some: { userId } } },
        AND: [{ organization: { memberships: { some: { userId: 'member' } } } }],
      },
      data: {
        title: 'Updated', description: 'Details', status: TaskStatus.DONE,
        assigneeId: 'member', dueDate: new Date('2026-10-30'), version: { increment: 1 },
      },
    }));
    expect(prisma.task.findFirst).toHaveBeenCalledOnce();
    expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-a', organizationId, version: 2, organization: { memberships: { some: { userId } } } },
    }));
    expect(activity.record).toHaveBeenCalledWith(prisma, {
      organizationId, taskId: 'task-a', taskTitle: 'Updated', actorId: userId, type: 'TASK_UPDATED',
      changes: [
        { field: 'title', from: 'Old', to: 'Updated' },
        { field: 'description', from: null, to: null },
        { field: 'status', from: 'TODO', to: 'DONE' },
        { field: 'assignee', from: null, to: 'Member' },
        { field: 'dueDate', from: null, to: '2026-10-30T00:00:00.000Z' },
      ],
    });
  });

  it('accepts only projects of the same organization and records project changes', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.project.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(organizationId, userId, { title: 'Task', projectId: 'foreign' }))
      .rejects.toMatchObject({ status: 400 });
    expect(prisma.project.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', organizationId }, select: { id: true } });
    expect(prisma.task.create).not.toHaveBeenCalled();

    const task = { id: 'task-a', organizationId, version: 1, title: 'T', description: null, status: 'TODO', dueDate: null, assignee: null, project: null };
    prisma.project.findFirst.mockResolvedValueOnce({ id: 'p1' });
    prisma.task.findFirst.mockResolvedValue(task);
    prisma.task.updateManyAndReturn.mockResolvedValue([{ ...task, version: 2, project: { id: 'p1', name: 'Site' } }]);
    await service.update(organizationId, 'task-a', userId, { version: 1, projectId: 'p1' });
    expect(prisma.task.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ projectId: 'p1' }),
    }));
    expect(activity.record).toHaveBeenCalledWith(prisma, expect.objectContaining({
      changes: [{ field: 'project', from: null, to: 'Site' }],
    }));
  });

  it('notifies the assignee of a new task unless they created it', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.create.mockResolvedValue({ id: 'task-a', title: 'Task', assigneeId: 'member' });
    await service.create(organizationId, userId, { title: 'Task', assigneeId: 'member' });
    expect(notifications.notify).toHaveBeenCalledWith(prisma, {
      organizationId, taskId: 'task-a', taskTitle: 'Task', actorId: userId, type: 'TASK_ASSIGNED', recipients: ['member'],
    });
  });

  it('notifies only when the assignee changes to someone', async () => {
    const task = { id: 'task-a', organizationId, version: 1, title: 'T', description: null, status: 'TODO', dueDate: null, assigneeId: null, assignee: null };
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findFirst.mockResolvedValue(task);
    prisma.task.updateManyAndReturn.mockResolvedValueOnce([{ ...task, version: 2, assigneeId: 'member', assignee: { id: 'member', name: 'M' } }]);
    await service.update(organizationId, 'task-a', userId, { version: 1, assigneeId: 'member' });
    expect(notifications.notify).toHaveBeenCalledWith(prisma, expect.objectContaining({ type: 'TASK_ASSIGNED', recipients: ['member'] }));
    notifications.notify.mockClear();
    prisma.task.updateManyAndReturn.mockResolvedValueOnce([{ ...task, version: 2, title: 'Novo' }]);
    await service.update(organizationId, 'task-a', userId, { version: 1, title: 'Novo' });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('does not record history when only the version changes', async () => {
    const task = { id: 'task-a', organizationId, version: 1, title: 'Same', description: null, status: 'TODO', dueDate: null, assignee: null };
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findFirst.mockResolvedValue(task);
    prisma.task.updateManyAndReturn.mockResolvedValue([{ ...task, version: 2 }]);
    await service.update(organizationId, 'task-a', userId, { version: 1 });
    expect(activity.record).not.toHaveBeenCalled();
  });

  it.each([
    ['title', { version: 1, title: 'New title' }, { title: 'New title' }],
    ['status', { version: 1, status: TaskStatus.IN_PROGRESS }, { status: TaskStatus.IN_PROGRESS }],
    ['removing the assignee', { version: 1, assigneeId: null }, { assigneeId: null }],
    ['removing the due date', { version: 1, dueDate: null }, { dueDate: null }],
    ['removing the description', { version: 1, description: null }, { description: null }],
  ])('updates %s without replacing omitted fields', async (_label, dto, expected) => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.updateManyAndReturn.mockResolvedValue([{ id: 'task-a', version: 2 }]);
    await service.update(organizationId, 'task-a', userId, dto);
    expect(prisma.task.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'task-a', organizationId, version: 1,
        organization: { memberships: { some: { userId } } },
      },
      data: {
        title: undefined, description: undefined, status: undefined,
        assigneeId: undefined, dueDate: undefined, version: { increment: 1 }, ...expected,
      },
    }));
  });

  it('does not update tasks for a user outside the organization', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.update(organizationId, 'task-a', userId, { version: 1, title: 'Title' }))
      .rejects.toMatchObject({ status: 404 });
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('rejects an assignee outside the organization', async () => {
    prisma.membership.findUnique
      .mockResolvedValueOnce({ id: 'requester' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'requester' });
    prisma.task.findFirst.mockResolvedValue({ id: 'task-a', version: 1 });
    await expect(service.update(organizationId, 'task-a', userId, {
      version: 1, assigneeId: 'outsider',
    })).rejects.toMatchObject({ status: 403 });
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('does not disclose a cross-tenant task when the proposed assignee is invalid', async () => {
    prisma.membership.findUnique
      .mockResolvedValueOnce({ id: 'requester' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'requester' });
    prisma.task.findFirst.mockResolvedValue(null);
    await expect(service.update(organizationId, 'other-task', userId, {
      version: 1, assigneeId: 'outsider',
    })).rejects.toMatchObject({ status: 404 });
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('returns 404 for missing tasks and tasks in another tenant', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.updateManyAndReturn.mockResolvedValue([]);
    prisma.task.findFirst.mockResolvedValue(null);
    await expect(service.update(organizationId, 'other-task', userId, { version: 1, title: 'Title' }))
      .rejects.toMatchObject({ status: 404 });
    expect(prisma.task.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'other-task', organizationId, version: 1,
        organization: { memberships: { some: { userId } } },
      },
    }));
  });

  it('returns 409 when the version is stale after a failed conditional update', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.updateManyAndReturn.mockResolvedValue([]);
    prisma.task.findFirst.mockResolvedValue({ id: 'task-a', version: 2 });
    await expect(service.update(organizationId, 'task-a', userId, { version: 1, title: 'Title' }))
      .rejects.toMatchObject({ status: 409 });
    expect(prisma.task.updateManyAndReturn).toHaveBeenCalledOnce();
  });

  it('does not update when an assignee membership is revoked before the atomic update', async () => {
    prisma.membership.findUnique
      .mockResolvedValueOnce({ id: 'requester' })
      .mockResolvedValueOnce({ id: 'assignee' })
      .mockResolvedValueOnce({ id: 'requester' })
      .mockResolvedValueOnce(null);
    prisma.task.updateManyAndReturn.mockResolvedValue([]);
    prisma.task.findFirst.mockResolvedValue({ id: 'task-a', version: 1 });
    await expect(service.update(organizationId, 'task-a', userId, { version: 1, assigneeId: 'member' }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('returns 404 if the requester membership is revoked before the atomic update', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ id: 'requester' }).mockResolvedValueOnce(null);
    prisma.task.updateManyAndReturn.mockResolvedValue([]);
    await expect(service.update(organizationId, 'task-a', userId, { version: 1, title: 'Title' }))
      .rejects.toMatchObject({ status: 404 });
    // Somente a leitura do estado anterior, dentro da transação; nenhuma consulta de fallback.
    expect(prisma.task.findFirst).toHaveBeenCalledOnce();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('deletes only the requested version and organization in a single conditional operation', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.deleteMany.mockResolvedValue({ count: 1 });
    prisma.task.findFirst.mockResolvedValue({ title: 'Removed task' });
    await expect(service.remove(organizationId, 'task-a', userId, 3)).resolves.toBeUndefined();
    expect(prisma.task.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'task-a',
        organizationId,
        version: 3,
        organization: { memberships: { some: { userId } } },
      },
    });
    expect(prisma.task.findFirst).toHaveBeenCalledOnce();
    expect(activity.record).toHaveBeenCalledWith(prisma, {
      organizationId, taskId: null, taskTitle: 'Removed task', actorId: userId, type: 'TASK_DELETED',
    });
    expect(storage.deleteQuietly).toHaveBeenCalledWith([]);
  });

  it('locks the task and removes its attachment objects only after a successful delete', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.findFirst.mockResolvedValue({ title: 'With files' });
    prisma.taskAttachment.findMany.mockResolvedValue([{ storageKey: 'k1' }, { storageKey: 'k2' }]);
    prisma.task.deleteMany.mockResolvedValueOnce({ count: 1 });
    await service.remove(organizationId, 'task-a', userId, 1);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.taskAttachment.findMany).toHaveBeenCalledWith({ where: { taskId: 'task-a', organizationId }, select: { storageKey: true } });
    expect(storage.deleteQuietly).toHaveBeenCalledWith(['k1', 'k2']);

    storage.deleteQuietly.mockClear();
    prisma.task.deleteMany.mockResolvedValueOnce({ count: 0 });
    prisma.task.findFirst.mockResolvedValueOnce({ title: 'With files' }).mockResolvedValueOnce({ id: 'task-a', version: 2 });
    await expect(service.remove(organizationId, 'task-a', userId, 1)).rejects.toMatchObject({ status: 409 });
    expect(storage.deleteQuietly).not.toHaveBeenCalled();
  });

  it('does not delete for a requester without an organization membership', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.remove(organizationId, 'task-a', userId, 1))
      .rejects.toMatchObject({ status: 404 });
    expect(prisma.task.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the task does not exist in the requested organization', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.deleteMany.mockResolvedValue({ count: 0 });
    prisma.task.findFirst.mockResolvedValue(null);
    await expect(service.remove(organizationId, 'other-tenant-task', userId, 1))
      .rejects.toMatchObject({ status: 404 });
    expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'other-tenant-task', organizationId,
        organization: { memberships: { some: { userId } } },
      },
    }));
  });

  it('returns 409 without deleting a task when the version is stale', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.deleteMany.mockResolvedValue({ count: 0 });
    prisma.task.findFirst.mockResolvedValue({ id: 'task-a', version: 2 });
    await expect(service.remove(organizationId, 'task-a', userId, 1))
      .rejects.toMatchObject({ status: 409 });
    expect(prisma.task.deleteMany).toHaveBeenCalledOnce();
  });

  it('does not delete when membership is revoked before the conditional delete', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ id: 'requester' }).mockResolvedValueOnce(null);
    prisma.task.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove(organizationId, 'task-a', userId, 1))
      .rejects.toMatchObject({ status: 404 });
    expect(prisma.task.findFirst).toHaveBeenCalledOnce();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('propagates unexpected database failures during deletion', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.deleteMany.mockRejectedValue(new Error('database unavailable'));
    await expect(service.remove(organizationId, 'task-a', userId, 1))
      .rejects.toThrow('database unavailable');
  });
});
