import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from './tasks.service.js';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn> };
    task: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  const organizationId = 'organization-a';
  const userId = 'creator';

  beforeEach(async () => {
    prisma = {
      membership: { findUnique: vi.fn() },
      task: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
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
});
