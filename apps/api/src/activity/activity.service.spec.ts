import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { activitySelect, ActivityService } from './activity.service.js';
import { taskChanges } from './task-changes.js';

describe('ActivityService', () => {
  let service: ActivityService;
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn> };
    task: { findFirst: ReturnType<typeof vi.fn> };
    taskActivity: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  };
  const row = (id: string) => ({ id, type: 'TASK_CREATED', taskId: 't', taskTitle: 'T', changes: null, createdAt: new Date(), actor: { id: 'u', name: 'U' } });

  beforeEach(async () => {
    prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ id: 'm' }) },
      task: { findFirst: vi.fn().mockResolvedValue({ id: 't' }) },
      taskActivity: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    };
    const module = await Test.createTestingModule({
      providers: [ActivityService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ActivityService);
  });

  it('records the event with the transaction client it receives', async () => {
    const tx = { taskActivity: { create: vi.fn() } };
    await service.record(tx as never, {
      organizationId: 'o', taskId: 't', taskTitle: 'T', actorId: 'u', type: 'TASK_UPDATED',
      changes: [{ field: 'status', from: 'TODO', to: 'DONE' }],
    });
    expect(tx.taskActivity.create).toHaveBeenCalledWith({ data: {
      organizationId: 'o', taskId: 't', taskTitle: 'T', actorId: 'u', type: 'TASK_UPDATED',
      changes: [{ field: 'status', from: 'TODO', to: 'DONE' }],
    } });
    expect(prisma.taskActivity.create).not.toHaveBeenCalled();
  });

  it('pages the organization feed newest first with a validated cursor', async () => {
    prisma.taskActivity.findFirst.mockResolvedValue({ id: 'a0' });
    prisma.taskActivity.findMany.mockResolvedValue([row('a1'), row('a2'), row('a3')]);
    const page = await service.listForOrganization('o', 'u', { limit: 2, before: 'a0' });
    expect(prisma.taskActivity.findFirst).toHaveBeenCalledWith({ where: { organizationId: 'o', id: 'a0' }, select: { id: true } });
    expect(prisma.taskActivity.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'o' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3, cursor: { id: 'a0' }, skip: 1, select: activitySelect,
    });
    expect(page).toMatchObject({ nextCursor: 'a2' });
    expect(page.data).toHaveLength(2);
  });

  it('returns 404 for non-members and unknown tasks, and 400 for a foreign cursor', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    await expect(service.listForOrganization('o', 'u', {})).rejects.toMatchObject({ status: 404 });
    prisma.task.findFirst.mockResolvedValueOnce(null);
    await expect(service.listForTask('o', 't', 'u', {})).rejects.toMatchObject({ status: 404 });
    prisma.taskActivity.findFirst.mockResolvedValueOnce(null);
    await expect(service.listForTask('o', 't', 'u', { before: 'x' })).rejects.toMatchObject({ status: 400 });
    expect(prisma.taskActivity.findMany).not.toHaveBeenCalled();
  });
});

describe('taskChanges', () => {
  const base = { title: 'A', description: 'd', status: 'TODO', dueDate: null, assignee: { id: '1', name: 'Ana' } };

  it('returns nothing when the visible fields are unchanged', () => {
    expect(taskChanges(base, { ...base })).toEqual([]);
  });

  it('records assignee names, normalized dates and only a flag for the description', () => {
    expect(taskChanges(base, { ...base, description: 'novo', assignee: null, dueDate: '2026-01-01T03:00:00-03:00' })).toEqual([
      { field: 'description', from: null, to: null },
      { field: 'assignee', from: 'Ana', to: null },
      { field: 'dueDate', from: null, to: '2026-01-01T06:00:00.000Z' },
    ]);
  });
});
