import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskStatus } from './dto/update-task.dto.js';
import { TasksService } from './tasks.service.js';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn> };
    task: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      updateManyAndReturn: ReturnType<typeof vi.fn>;
    };
  };
  const organizationId = 'organization-a';
  const userId = 'creator';

  beforeEach(async () => {
    prisma = {
      membership: { findUnique: vi.fn() },
      task: {
        create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(),
        deleteMany: vi.fn(), updateManyAndReturn: vi.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [TasksService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TasksService);
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
        assigneeId: 'member', dueDate: new Date('2026-10-30'),
      },
    }));
  });

  it('rejects task reads by users outside the organization without querying tasks', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.findAll(organizationId, userId)).rejects.toMatchObject({ status: 404 });
    await expect(service.findOne(organizationId, 'task-b', userId)).rejects.toMatchObject({ status: 404 });
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
  });

  it('lists only authorized organization tasks in deterministic update order with safe fields', async () => {
    const tasks = [{ id: 'task-a', creator: { id: userId, name: 'Creator' }, assignee: null }];
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findMany.mockResolvedValue(tasks);

    await expect(service.findAll(organizationId, userId)).resolves.toEqual(tasks);
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId, userId } },
    });
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { organizationId, organization: { memberships: { some: { userId } } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, title: true, description: true, status: true, version: true,
        dueDate: true, createdAt: true, updatedAt: true, creatorId: true,
        assigneeId: true, organizationId: true,
        creator: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
  });

  it('returns an empty list for an authorized organization without tasks', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.findMany.mockResolvedValue([]);
    await expect(service.findAll(organizationId, userId)).resolves.toEqual([]);
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

  it('updates supplied fields atomically and increments the version', async () => {
    const updated = { id: 'task-a', organizationId, version: 3 };
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
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
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
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
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
  });

  it('deletes only the requested version and organization in a single conditional operation', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.remove(organizationId, 'task-a', userId, 3)).resolves.toBeUndefined();
    expect(prisma.task.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'task-a',
        organizationId,
        version: 3,
        organization: { memberships: { some: { userId } } },
      },
    });
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
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
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
  });

  it('propagates unexpected database failures during deletion', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'requester' });
    prisma.task.deleteMany.mockRejectedValue(new Error('database unavailable'));
    await expect(service.remove(organizationId, 'task-a', userId, 1))
      .rejects.toThrow('database unavailable');
  });
});
